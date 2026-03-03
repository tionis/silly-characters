import { Router, Request, Response } from "express";
import Database from "better-sqlite3";
import { createDatabaseService } from "../../services/database";
import { logger } from "../../utils/logger";
import { AppError } from "../../errors/app-error";
import { sendError } from "../../errors/http";
import {
  ensureCardInLibraries,
  resolveUserLibraryIds,
} from "../../services/user-libraries";
import {
  fromNextcloudVirtualPath,
  getNextcloudUserContext,
} from "../../services/nextcloud-storage";

const router = Router();

function getDb(req: Request): Database.Database {
  return req.app.locals.db as Database.Database;
}

router.get("/image/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const db = getDb(req);
    const userId = req.currentUser?.id ?? null;
    if (!userId) {
      throw new AppError({ status: 401, code: "api.auth.unauthorized" });
    }

    const libraryIds = await resolveUserLibraryIds(db, userId);
    ensureCardInLibraries(db, id, libraryIds);
    const dbService = createDatabaseService(db);

    const fileRow = dbService.queryOne<{ file_path: string | null }>(
      `
      SELECT COALESCE(
        c.primary_file_path,
        (
          SELECT cf.file_path
          FROM card_files cf
          WHERE cf.card_id = c.id
          ORDER BY cf.file_birthtime ASC, cf.file_path ASC
          LIMIT 1
        )
      ) as file_path
      FROM cards c
      WHERE c.id = ?
      LIMIT 1
    `,
      [id]
    );

    if (!fileRow || !fileRow.file_path) {
      throw new AppError({ status: 404, code: "api.image.not_found" });
    }

    const remotePath = fromNextcloudVirtualPath(userId, fileRow.file_path);
    if (!remotePath) {
      throw new AppError({ status: 404, code: "api.image.not_found" });
    }

    const ctx = await getNextcloudUserContext(db, userId);
    const binary = await ctx.client.downloadFile(remotePath);

    res.setHeader("Content-Type", "image/png");
    res.send(binary);
  } catch (error) {
    logger.errorKey(error, "api.image.get_failed");
    return sendError(res, error, { status: 500, code: "api.image.get_failed" });
  }
});

export default router;
