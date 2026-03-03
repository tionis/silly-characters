import { Router, Request, Response } from "express";
import type Database from "better-sqlite3";
import {
  getViewSettings,
  updateViewSettings,
  ViewSettings,
} from "../../services/view-settings";
import { logger } from "../../utils/logger";
import { AppError } from "../../errors/app-error";
import { sendError } from "../../errors/http";

const router = Router();

function getDb(req: Request): Database.Database {
  return req.app.locals.db as Database.Database;
}

// GET /api/view-settings - получение текущих настроек отображения
router.get("/view-settings", async (req: Request, res: Response) => {
  try {
    const db = getDb(req);
    const userId = req.currentUser?.id ?? null;
    const settings = await getViewSettings(db, userId);
    res.json(settings);
  } catch (error) {
    logger.errorKey(error, "api.viewSettings.get_failed");
    return sendError(res, error, {
      status: 500,
      code: "api.viewSettings.get_failed",
    });
  }
});

// PUT /api/view-settings - обновление настроек отображения (полное обновление)
router.put("/view-settings", async (req: Request, res: Response) => {
  try {
    const db = getDb(req);
    const userId = req.currentUser?.id ?? null;
    const newSettings = req.body as ViewSettings;

    // Валидация структуры данных
    if (
      typeof newSettings !== "object" ||
      newSettings === null ||
      !("columnsCount" in newSettings) ||
      !("isCensored" in newSettings) ||
      ("colorScheme" in newSettings &&
        typeof newSettings.colorScheme !== "string")
    ) {
      throw new AppError({
        status: 400,
        code: "api.viewSettings.invalid_format",
      });
    }

    // Полное обновление настроек (валидация происходит внутри updateViewSettings)
    const savedSettings = await updateViewSettings(db, newSettings, userId);

    res.json(savedSettings);
  } catch (error) {
    logger.errorKey(error, "api.viewSettings.update_failed");
    return sendError(res, error, {
      status: 500,
      code: "api.viewSettings.update_failed",
    });
  }
});

export default router;
