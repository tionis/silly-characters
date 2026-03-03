import { Router, Request, Response } from "express";
import type Database from "better-sqlite3";
import {
  getSettingsForUser,
  updateSettingsForUser,
  Settings,
  validateLanguage,
} from "../../services/settings";
import { logger } from "../../utils/logger";
import { setCurrentLanguage } from "../../i18n/language";
import { AppError } from "../../errors/app-error";
import { sendError } from "../../errors/http";

const router = Router();

function getDb(req: Request): Database.Database {
  return req.app.locals.db as Database.Database;
}

// GET /api/settings - получение текущих настроек
router.get("/settings", async (req: Request, res: Response) => {
  try {
    const db = getDb(req);
    const userId = req.currentUser?.id ?? null;
    const settings = await getSettingsForUser(userId, db);
    res.json(settings);
  } catch (error) {
    logger.errorKey(error, "api.settings.get_failed");
    return sendError(res, error, {
      status: 500,
      code: "api.settings.get_failed",
    });
  }
});

// PUT /api/settings - обновление настроек (полное обновление)
router.put("/settings", async (req: Request, res: Response) => {
  try {
    const db = getDb(req);
    const userId = req.currentUser?.id ?? null;
    if (!userId) {
      throw new AppError({
        status: 401,
        code: "api.auth.unauthorized",
      });
    }

    const payload = req.body as Partial<Settings>;
    if (typeof payload !== "object" || payload === null) {
      throw new AppError({
        status: 400,
        code: "api.settings.invalid_format",
      });
    }

    const prevSettings = await getSettingsForUser(userId, db);
    const nextLanguage =
      payload.language != null ? payload.language : prevSettings.language;
    validateLanguage(nextLanguage);

    // Nextcloud-backed mode: cards/silly paths are managed by auth/sync flow.
    const nextSettings: Settings = {
      ...prevSettings,
      language: nextLanguage,
      sillytavenrPath: null,
    };

    const savedSettings = await updateSettingsForUser(
      nextSettings,
      userId,
      { skipPathValidation: true },
      db
    );
    // Обновляем язык в рантайме, чтобы логи/ошибки переключались сразу
    setCurrentLanguage(savedSettings.language);

    res.json(savedSettings);
  } catch (error) {
    logger.errorKey(error, "api.settings.update_failed");
    return sendError(res, error, {
      status: 500,
      code: "api.settings.update_failed",
    });
  }
});

export default router;
