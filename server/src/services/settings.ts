import { accessSync, constants } from "node:fs";
import { readFile, writeFile, ensureDir } from "fs-extra";
import { dirname, join } from "node:path";
import { AppError } from "../errors/app-error";

export type Language = "ru" | "en";

export interface Settings {
  cardsFolderPath: string | null;
  sillytavenrPath: string | null;
  language: Language;
}

function settingsFilePathForUser(userId?: string | null): string {
  const normalized = typeof userId === "string" ? userId.trim() : "";
  if (!normalized) {
    return join(process.cwd(), "data", "settings.global.json");
  }
  return join(process.cwd(), "data", "users", normalized, "settings.json");
}

const DEFAULT_SETTINGS: Settings = {
  cardsFolderPath: null,
  sillytavenrPath: null,
  language: "en",
};

/**
 * Проверяет существование пути через fs.accessSync
 * @param path Путь для проверки
 * @throws Error если путь не существует
 */
export function validatePath(path: string): void {
  try {
    accessSync(path, constants.F_OK);
  } catch (error) {
    throw new AppError({
      status: 400,
      code: "api.settings.path_not_exists",
      params: { path },
      cause: error,
    });
  }
}

export function validateLanguage(
  language: unknown
): asserts language is Language {
  if (language !== "ru" && language !== "en") {
    throw new AppError({
      status: 400,
      code: "api.settings.invalid_language",
      params: { language: String(language) },
    });
  }
}

/**
 * Читает настройки из файла. Если файл не существует, создает его с дефолтными значениями.
 * @returns Текущие настройки
 */
export async function getSettings(): Promise<Settings> {
  return getSettingsForUser();
}

export async function getSettingsForUser(userId?: string | null): Promise<Settings> {
  const settingsFilePath = settingsFilePathForUser(userId);
  try {
    const data = await readFile(settingsFilePath, "utf-8");
    const parsed = JSON.parse(data) as Partial<Settings>;
    const merged: Settings = { ...DEFAULT_SETTINGS, ...parsed };

    // If language value in file is invalid, fall back to default.
    try {
      validateLanguage(merged.language);
      return merged;
    } catch {
      return { ...merged, language: DEFAULT_SETTINGS.language };
    }
  } catch (error) {
    // Если файл не существует, создаем его с дефолтными значениями
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await ensureDir(dirname(settingsFilePath));
      await writeFile(
        settingsFilePath,
        JSON.stringify(DEFAULT_SETTINGS, null, 2),
        "utf-8"
      );
      return DEFAULT_SETTINGS;
    }
    throw error;
  }
}

/**
 * Обновляет настройки с валидацией путей
 * @param newSettings Новые настройки
 * @throws Error если какой-то из путей не существует
 */
export async function updateSettings(newSettings: Settings): Promise<Settings> {
  return updateSettingsForUser(newSettings);
}

export async function updateSettingsForUser(
  newSettings: Settings,
  userId?: string | null,
  options?: { skipPathValidation?: boolean }
): Promise<Settings> {
  const settingsFilePath = settingsFilePathForUser(userId);
  const normalized: Settings = {
    ...DEFAULT_SETTINGS,
    ...(newSettings as Partial<Settings>),
  };

  validateLanguage(normalized.language);

  // Валидация путей: если путь указан (не null), проверяем его существование
  if (!options?.skipPathValidation && normalized.cardsFolderPath !== null) {
    validatePath(normalized.cardsFolderPath);
  }

  if (!options?.skipPathValidation && normalized.sillytavenrPath !== null) {
    validatePath(normalized.sillytavenrPath);
  }

  // Убеждаемся, что папка data существует
  await ensureDir(dirname(settingsFilePath));

  // Сохраняем настройки
  await writeFile(
    settingsFilePath,
    JSON.stringify(normalized, null, 2),
    "utf-8"
  );

  return normalized;
}
