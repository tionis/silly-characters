import type Database from "better-sqlite3";
import { AppError } from "../errors/app-error";

export type ColumnsCount = 3 | 5 | 7;
export type ColorScheme = "light" | "dark" | "auto";

export interface ViewSettings {
  columnsCount: ColumnsCount;
  isCensored: boolean;
  colorScheme: ColorScheme;
}

const DEFAULT_SETTINGS: ViewSettings = {
  columnsCount: 5,
  isCensored: false,
  colorScheme: "auto",
};

function normalizeUserId(userId?: string | null): string | null {
  const normalized = typeof userId === "string" ? userId.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function isValidColumnsCount(value: number): value is ColumnsCount {
  return value === 3 || value === 5 || value === 7;
}

function isValidColorScheme(value: unknown): value is ColorScheme {
  return value === "light" || value === "dark" || value === "auto";
}

function normalizeViewSettings(raw: unknown): ViewSettings {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<ViewSettings>;
  return {
    columnsCount:
      typeof src.columnsCount === "number" && isValidColumnsCount(src.columnsCount)
        ? src.columnsCount
        : DEFAULT_SETTINGS.columnsCount,
    isCensored:
      typeof src.isCensored === "boolean"
        ? src.isCensored
        : DEFAULT_SETTINGS.isCensored,
    colorScheme: isValidColorScheme(src.colorScheme)
      ? src.colorScheme
      : DEFAULT_SETTINGS.colorScheme,
  };
}

type ViewSettingsRow = {
  columns_count: number;
  is_censored: number;
  color_scheme: string;
};

function rowToViewSettings(row: ViewSettingsRow): ViewSettings {
  return normalizeViewSettings({
    columnsCount: row.columns_count,
    isCensored: row.is_censored === 1,
    colorScheme: row.color_scheme,
  });
}

function upsertViewSettingsRow(
  db: Database.Database,
  userId: string,
  settings: ViewSettings
): void {
  const now = Date.now();
  db.prepare(
    `
      INSERT INTO user_view_settings (
        user_id,
        columns_count,
        is_censored,
        color_scheme,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        columns_count = excluded.columns_count,
        is_censored = excluded.is_censored,
        color_scheme = excluded.color_scheme,
        updated_at = excluded.updated_at
    `
  ).run(
    userId,
    settings.columnsCount,
    settings.isCensored ? 1 : 0,
    settings.colorScheme,
    now
  );
}

export async function getViewSettings(
  db: Database.Database,
  userId?: string | null
): Promise<ViewSettings> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return DEFAULT_SETTINGS;
  }

  const row = db
    .prepare(
      `
        SELECT columns_count, is_censored, color_scheme
        FROM user_view_settings
        WHERE user_id = ?
        LIMIT 1
      `
    )
    .get(normalizedUserId) as ViewSettingsRow | undefined;

  if (row) return rowToViewSettings(row);

  const initial = DEFAULT_SETTINGS;
  upsertViewSettingsRow(db, normalizedUserId, initial);
  return initial;
}

export async function updateViewSettings(
  db: Database.Database,
  newSettings: ViewSettings,
  userId?: string | null
): Promise<ViewSettings> {
  if (
    typeof newSettings !== "object" ||
    newSettings === null ||
    typeof newSettings.columnsCount !== "number" ||
    !isValidColumnsCount(newSettings.columnsCount) ||
    typeof newSettings.isCensored !== "boolean" ||
    !isValidColorScheme(newSettings.colorScheme)
  ) {
    throw new AppError({
      status: 400,
      code: "api.viewSettings.invalid_format",
    });
  }

  const normalized = normalizeViewSettings(newSettings);
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return normalized;
  }

  upsertViewSettingsRow(db, normalizedUserId, normalized);
  return normalized;
}
