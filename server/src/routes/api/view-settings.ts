import { Router, Request, Response } from "express";
import {
  getViewSettings,
  updateViewSettings,
  ViewSettings,
} from "../../services/view-settings";
import { logger } from "../../utils/logger";
import { AppError } from "../../errors/app-error";
import { sendError } from "../../errors/http";

const router = Router();

// GET /api/view-settings - получение текущих настроек отображения
router.get("/view-settings", async (req: Request, res: Response) => {
  try {
    const settings = await getViewSettings();
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
    const savedSettings = await updateViewSettings(newSettings);

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
