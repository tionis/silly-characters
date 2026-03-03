import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { readFile } from "node:fs/promises";
import type { SseHub } from "../../services/sse-hub";
import { AppError } from "../../errors/app-error";
import { sendError } from "../../errors/http";
import { logger } from "../../utils/logger";
import { createDatabaseService } from "../../services/database";
import { CardParser } from "../../services/card-parser";
import { computeContentHash } from "../../services/card-hash";
import { remove } from "fs-extra";
import { sanitizeWindowsFilenameBase } from "../../utils/filename";
import {
  getNextcloudUserContext,
  pickUniqueRemotePngPath,
} from "../../services/nextcloud-storage";
import { syncUserNextcloudIndex } from "../../services/nextcloud-index";

const router = Router();
const upload = multer({
  dest: join(process.cwd(), "data", "tmp", "uploads"),
  limits: {
    files: 1000,
    fileSize: 50 * 1024 * 1024,
  },
});

function getDb(req: Request): Database.Database {
  return req.app.locals.db as Database.Database;
}

function getHub(req: Request): SseHub {
  const hub = (req.app.locals as any).sseHub as SseHub | undefined;
  if (!hub) throw new Error("SSE hub is not initialized");
  return hub;
}

type ImportRunState = { running: boolean };
type DuplicatesMode = "skip" | "copy";

function getState(req: Request): ImportRunState {
  const locals = req.app.locals as any;
  if (!locals.cardsImportState) locals.cardsImportState = { running: false };
  return locals.cardsImportState as ImportRunState;
}

function parseDuplicatesMode(raw: unknown): DuplicatesMode | null {
  if (raw === "skip" || raw === "copy") return raw;
  return null;
}

router.post(
  "/cards/import",
  upload.array("files", 1000),
  async (req: Request, res: Response) => {
    const state = getState(req);
    if (state.running) {
      return sendError(
        res,
        new AppError({ status: 409, code: "api.cardsImport.already_running" })
      );
    }

    const uploadedFiles = (req.files ?? []) as Express.Multer.File[];

    try {
      const duplicatesMode = parseDuplicatesMode((req.body as any)?.duplicatesMode);
      if (!duplicatesMode || uploadedFiles.length === 0) {
        throw new AppError({
          status: 400,
          code: "api.cardsImport.invalid_format",
        });
      }

      const userId = req.currentUser?.id ?? null;
      if (!userId) {
        throw new AppError({ status: 401, code: "api.auth.unauthorized" });
      }

      const db = getDb(req);
      const hub = getHub(req);
      const ctx = await getNextcloudUserContext(db, userId);
      await ctx.client.ensureFolderExists(ctx.remoteFolder);

      const dbService = createDatabaseService(db);
      const parser = new CardParser();
      const knownDuplicateHashes = new Set<string>();

      const startedAt = Date.now();
      let processedFiles = 0;
      let importedFiles = 0;
      let skippedParseErrors = 0;
      let skippedDuplicates = 0;
      let copyFailed = 0;

      state.running = true;

      for (const file of uploadedFiles) {
        processedFiles += 1;
        const originalName =
          typeof file.originalname === "string" && file.originalname.trim().length > 0
            ? file.originalname.trim()
            : `upload-${randomUUID()}.png`;

        const isPng =
          extname(originalName).toLowerCase() === ".png" ||
          String(file.mimetype ?? "").toLowerCase() === "image/png";
        if (!isPng) {
          skippedParseErrors += 1;
          await remove(file.path).catch(() => undefined);
          continue;
        }

        const baseName = sanitizeWindowsFilenameBase(
          originalName.replace(/\.png$/i, ""),
          "uploaded-card"
        );

        try {
          const extracted = parser.parse(file.path);
          if (!extracted) {
            skippedParseErrors += 1;
            await remove(file.path).catch(() => undefined);
            continue;
          }

          const contentHash = computeContentHash(extracted.original_data);
          if (duplicatesMode === "skip") {
            if (knownDuplicateHashes.has(contentHash)) {
              skippedDuplicates += 1;
              await remove(file.path).catch(() => undefined);
              continue;
            }

            const exists = dbService.queryOne<{ one: number }>(
              `SELECT 1 as one FROM cards WHERE library_id = ? AND content_hash = ? LIMIT 1`,
              [ctx.libraryId, contentHash]
            );
            if (exists) {
              knownDuplicateHashes.add(contentHash);
              skippedDuplicates += 1;
              await remove(file.path).catch(() => undefined);
              continue;
            }

            knownDuplicateHashes.add(contentHash);
          }

          const remotePath = await pickUniqueRemotePngPath({
            client: ctx.client,
            folder: ctx.remoteFolder,
            baseName,
          });

          const content = await readFile(file.path);
          await ctx.client.uploadFile(remotePath, content, "image/png");
          importedFiles += 1;
        } catch (error) {
          copyFailed += 1;
          logger.errorKey(error, "error.cardsImport.copyFailed", {
            source: file.path,
            target: ctx.remoteFolder,
          });
        } finally {
          await remove(file.path).catch(() => undefined);
        }
      }

      await syncUserNextcloudIndex({ db, userId });

      const finishedAt = Date.now();
      hub.broadcast(
        "cards:import_finished",
        {
          sourceFolderPath: "[uploaded-from-browser]",
          targetFolderPath: ctx.remoteFolder,
          importMode: "copy",
          duplicatesMode,
          totalFiles: uploadedFiles.length,
          processedFiles,
          importedFiles,
          skippedParseErrors,
          skippedDuplicates,
          copyFailed,
          deletedOriginals: 0,
          deleteFailed: 0,
          startedAt,
          finishedAt,
          durationMs: finishedAt - startedAt,
        },
        { id: `${startedAt}:import_finished` }
      );

      res.status(202).json({
        ok: true,
        started: true,
        importedFiles,
        totalFiles: uploadedFiles.length,
      });
    } catch (error) {
      logger.errorKey(error, "api.cardsImport.start_failed");
      return sendError(res, error, {
        status: 500,
        code: "api.cardsImport.start_failed",
      });
    } finally {
      state.running = false;
      for (const file of uploadedFiles) {
        await remove(file.path).catch(() => undefined);
      }
    }
  }
);

export default router;
