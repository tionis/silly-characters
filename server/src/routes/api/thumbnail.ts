import { Router, Request, Response } from "express";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { logger } from "../../utils/logger";
import { AppError } from "../../errors/app-error";
import { sendError } from "../../errors/http";

const router = Router();

// GET /api/thumbnail/:id - получение миниатюры карточки
router.get("/thumbnail/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Построим путь к файлу миниатюры
    const thumbnailPath = join(
      process.cwd(),
      "data",
      "cache",
      "thumbnails",
      `${id}.webp`
    );

    // Проверяем существование файла
    if (!existsSync(thumbnailPath)) {
      throw new AppError({ status: 404, code: "api.thumbnail.not_found" });
    }

    // Отправляем файл с правильным Content-Type
    res.setHeader("Content-Type", "image/webp");
    res.sendFile(thumbnailPath);
  } catch (error) {
    logger.errorKey(error, "api.thumbnail.get_failed");
    return sendError(res, error, {
      status: 500,
      code: "api.thumbnail.get_failed",
    });
  }
});

export default router;
