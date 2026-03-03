import type Database from "better-sqlite3";
import { accessSync, constants } from "node:fs";
import { AppError } from "../errors/app-error";

export type Language = "ru" | "en";

export interface Settings {
  cardsFolderPath: string | null;
  sillytavenrPath: string | null;
  language: Language;
}

const DEFAULT_SETTINGS: Settings = {
  cardsFolderPath: null,
  sillytavenrPath: null,
  language: "en",
};

function normalizeUserId(userId?: string | null): string | null {
  const normalized = typeof userId === "string" ? userId.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function parseSettings(raw: unknown): Settings {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Settings>;
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...source,
  };

  try {
    validateLanguage(merged.language);
  } catch {
    merged.language = DEFAULT_SETTINGS.language;
  }

  merged.cardsFolderPath =
    typeof merged.cardsFolderPath === "string" && merged.cardsFolderPath.trim()
      ? merged.cardsFolderPath.trim()
      : null;
  merged.sillytavenrPath =
    typeof merged.sillytavenrPath === "string" && merged.sillytavenrPath.trim()
      ? merged.sillytavenrPath.trim()
      : null;

  return merged;
}

type SettingsRow = {
  cards_folder_path: string | null;
  sillytavenr_path: string | null;
  language: string;
};

function rowToSettings(row: SettingsRow): Settings {
  return parseSettings({
    cardsFolderPath: row.cards_folder_path,
    sillytavenrPath: row.sillytavenr_path,
    language: row.language,
  });
}

function upsertSettingsRow(
  db: Database.Database,
  userId: string,
  settings: Settings
): void {
  const now = Date.now();
  db.prepare(
    `
      INSERT INTO user_settings (
        user_id,
        cards_folder_path,
        sillytavenr_path,
        language,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        cards_folder_path = excluded.cards_folder_path,
        sillytavenr_path = excluded.sillytavenr_path,
        language = excluded.language,
        updated_at = excluded.updated_at
    `
  ).run(
    userId,
    settings.cardsFolderPath,
    settings.sillytavenrPath,
    settings.language,
    now
  );
}

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

export async function getSettings(db?: Database.Database): Promise<Settings> {
  return getSettingsForUser(null, db);
}

export async function getSettingsForUser(
  userId?: string | null,
  db?: Database.Database
): Promise<Settings> {
  const normalizedUserId = normalizeUserId(userId);

  if (!normalizedUserId) {
    return DEFAULT_SETTINGS;
  }

  if (!db) {
    throw new Error("Database is required for user-scoped settings");
  }

  const row = db
    .prepare(
      `
        SELECT cards_folder_path, sillytavenr_path, language
        FROM user_settings
        WHERE user_id = ?
        LIMIT 1
      `
    )
    .get(normalizedUserId) as SettingsRow | undefined;

  if (row) return rowToSettings(row);

  const initial = DEFAULT_SETTINGS;
  upsertSettingsRow(db, normalizedUserId, initial);
  return initial;
}

export async function updateSettings(
  newSettings: Settings,
  db?: Database.Database
): Promise<Settings> {
  return updateSettingsForUser(newSettings, null, undefined, db);
}

export async function updateSettingsForUser(
  newSettings: Settings,
  userId?: string | null,
  options?: { skipPathValidation?: boolean },
  db?: Database.Database
): Promise<Settings> {
  const normalized: Settings = parseSettings(newSettings as Partial<Settings>);
  validateLanguage(normalized.language);

  if (!options?.skipPathValidation && normalized.cardsFolderPath !== null) {
    validatePath(normalized.cardsFolderPath);
  }

  if (!options?.skipPathValidation && normalized.sillytavenrPath !== null) {
    validatePath(normalized.sillytavenrPath);
  }

  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return normalized;
  }

  if (!db) {
    throw new Error("Database is required for user-scoped settings");
  }

  upsertSettingsRow(db, normalizedUserId, normalized);
  return normalized;
}
