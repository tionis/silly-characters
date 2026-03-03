import { Router, Request, Response } from "express";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { createDatabaseService } from "../../services/database";
import { logger } from "../../utils/logger";
import { AppError } from "../../errors/app-error";
import { sendError } from "../../errors/http";
import {
  ensureCardInLibraries,
  resolveUserLibraryIds,
} from "../../services/user-libraries";

const router = Router();

// Middleware для получения базы данных из app.locals
function getDb(req: Request): Database.Database {
  return req.app.locals.db as Database.Database;
}

// GET /api/image/:id - получение оригинального PNG изображения карточки
router.get("/image/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const db = getDb(req);
    const libraryIds = await resolveUserLibraryIds(db, req.currentUser?.id ?? null);
    ensureCardInLibraries(db, id, libraryIds);
    const dbService = createDatabaseService(db);

    // Получаем основной file_path: override (cards.primary_file_path) или самый старый file_birthtime
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

    const filePath = fileRow.file_path;

    // Проверяем существование файла
    if (!existsSync(filePath)) {
      throw new AppError({ status: 404, code: "api.image.file_not_found" });
    }

    // Отправляем файл с правильным Content-Type
    res.setHeader("Content-Type", "image/png");
    res.sendFile(filePath);
  } catch (error) {
    logger.errorKey(error, "api.image.get_failed");
    return sendError(res, error, { status: 500, code: "api.image.get_failed" });
  }
});

export default router;
