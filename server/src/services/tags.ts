import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createDatabaseService, DatabaseService } from "./database";
import { AppError } from "../errors/app-error";

/**
 * Интерфейс тега
 */
export interface Tag {
  id: string;
  name: string;
  rawName: string;
}

/**
 * Сервис для работы с тегами
 */
export class TagService {
  constructor(private dbService: DatabaseService) {}

  /**
   * Нормализует имя тега (приводит к нижнему регистру)
   * @param name Имя тега
   * @returns Нормализованное имя
   */
  private normalizeTagName(name: string): string {
    return name.trim().toLowerCase();
  }

  /**
   * Валидирует имя тега
   * @param name Имя тега
   * @throws Error если валидация не прошла
   */
  private validateTagName(name: string): void {
    if (typeof name !== "string") {
      throw new AppError({ status: 400, code: "api.tags.name_invalid" });
    }
    if (!name.trim()) {
      throw new AppError({ status: 400, code: "api.tags.name_invalid" });
    }
    if (name.length > 255) {
      throw new AppError({ status: 400, code: "api.tags.name_invalid" });
    }
  }

  /**
   * Получает все теги
   * @returns Массив всех тегов
   */
  getAllTags(): Tag[] {
    const sql = `SELECT id, name, rawName FROM tags ORDER BY name ASC`;
    return this.dbService.query<Tag>(sql);
  }

  /**
   * Получает тег по ID
   * @param id ID тега
   * @returns Тег или undefined если не найден
   */
  getTagById(id: string): Tag | undefined {
    const sql = `SELECT id, name, rawName FROM tags WHERE id = ?`;
    return this.dbService.queryOne<Tag>(sql, [id]);
  }

  /**
   * Находит тег по rawName
   * @param rawName Нормализованное имя тега
   * @returns Тег или undefined если не найден
   */
  getTagByRawName(rawName: string): Tag | undefined {
    const sql = `SELECT id, name, rawName FROM tags WHERE rawName = ?`;
    return this.dbService.queryOne<Tag>(sql, [rawName]);
  }

  /**
   * Создает новый тег
   * @param name Имя тега
   * @returns Созданный тег
   * @throws Error если тег с таким rawName уже существует или валидация не прошла
   */
  createTag(name: string): Tag {
    this.validateTagName(name);

    const rawName = this.normalizeTagName(name);

    // Проверяем существование тега с таким rawName
    const existingTag = this.getTagByRawName(rawName);
    if (existingTag) {
      throw new AppError({
        status: 409,
        code: "api.tags.already_exists",
        extra: { existingTag },
      });
    }

    const id = randomUUID();
    const sql = `INSERT INTO tags (id, name, rawName) VALUES (?, ?, ?)`;
    this.dbService.execute(sql, [id, name.trim(), rawName]);

    return {
      id,
      name: name.trim(),
      rawName,
    };
  }

  /**
   * Обновляет тег (полное обновление)
   * @param id ID тега
   * @param name Новое имя тега
   * @returns Обновленный тег
   * @throws Error если тег не найден, валидация не прошла или тег с таким rawName уже существует
   */
  updateTag(id: string, name: string): Tag {
    this.validateTagName(name);

    // Проверяем существование тега
    const existingTag = this.getTagById(id);
    if (!existingTag) {
      throw new AppError({ status: 404, code: "api.tags.not_found" });
    }

    const rawName = this.normalizeTagName(name);

    // Проверяем, не существует ли другой тег с таким rawName
    const tagWithSameRawName = this.getTagByRawName(rawName);
    if (tagWithSameRawName && tagWithSameRawName.id !== id) {
      throw new AppError({
        status: 409,
        code: "api.tags.already_exists",
        extra: { existingTag: tagWithSameRawName },
      });
    }

    const sql = `UPDATE tags SET name = ?, rawName = ? WHERE id = ?`;
    this.dbService.execute(sql, [name.trim(), rawName, id]);

    return {
      id,
      name: name.trim(),
      rawName,
    };
  }

  /**
   * Частично обновляет тег (PATCH)
   * @param id ID тега
   * @param name Новое имя тега
   * @returns Обновленный тег
   * @throws Error если тег не найден, валидация не прошла или тег с таким rawName уже существует
   */
  patchTag(id: string, name: string): Tag {
    // PATCH работает так же как PUT в данном случае
    return this.updateTag(id, name);
  }

  /**
   * Удаляет тег
   * @param id ID тега
   * @throws Error если тег не найден
   */
  deleteTag(id: string): void {
    const existingTag = this.getTagById(id);
    if (!existingTag) {
      throw new AppError({ status: 404, code: "api.tags.not_found" });
    }

    const sql = `DELETE FROM tags WHERE id = ?`;
    this.dbService.execute(sql, [id]);
  }

  /**
   * Обеспечивает существование тегов (создает только несуществующие)
   * Используется при парсинге карточек для автоматического создания тегов
   * @param tags Массив имен тегов
   */
  ensureTagsExist(tags: string[]): void {
    if (!tags || tags.length === 0) {
      return;
    }

    for (const tagName of tags) {
      if (!tagName || typeof tagName !== "string") {
        continue;
      }

      try {
        const rawName = this.normalizeTagName(tagName);
        const existingTag = this.getTagByRawName(rawName);

        // Если тег не существует, создаем его
        if (!existingTag) {
          // Используем транзакцию для безопасности
          try {
            const id = randomUUID();
            const sql = `INSERT INTO tags (id, name, rawName) VALUES (?, ?, ?)`;
            this.dbService.execute(sql, [id, tagName.trim(), rawName]);
          } catch (error) {
            // Игнорируем ошибки уникальности (возможна гонка при параллельной обработке)
            // В этом случае тег уже был создан другим процессом
          }
        }
      } catch (error) {
        // Пропускаем невалидные теги при инициализации
        continue;
      }
    }
  }
}

/**
 * Создает экземпляр TagService из экземпляра Database
 */
export function createTagService(db: Database.Database): TagService {
  const dbService = createDatabaseService(db);
  return new TagService(dbService);
}
