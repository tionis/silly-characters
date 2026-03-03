import type Database from "better-sqlite3";
import { AppError } from "../errors/app-error";
import { getNextcloudConnectionStatus } from "./auth-store";
import { getOrCreateNextcloudLibraryId } from "./nextcloud-storage";

export async function resolveUserLibraryIds(
  db: Database.Database,
  userId: string | null
): Promise<string[]> {
  const normalizedUserId =
    typeof userId === "string" ? userId.trim() : "";
  if (!normalizedUserId) return [];

  const connection = getNextcloudConnectionStatus(db, normalizedUserId);
  const libraryIds: string[] = [];

  if (connection.connected && connection.remoteFolder) {
    libraryIds.push(
      getOrCreateNextcloudLibraryId(
        db,
        normalizedUserId,
        connection.remoteFolder
      )
    );
  }

  return Array.from(new Set(libraryIds));
}

export function ensureCardInLibraries(
  db: Database.Database,
  cardId: string,
  libraryIds: string[]
): void {
  if (libraryIds.length === 0) {
    throw new AppError({ status: 404, code: "api.cards.not_found" });
  }

  const placeholders = libraryIds.map(() => "?").join(", ");
  const row = db
    .prepare(
      `
      SELECT 1
      FROM cards
      WHERE id = ?
        AND library_id IN (${placeholders})
      LIMIT 1
    `
    )
    .get(cardId, ...libraryIds) as { 1: number } | undefined;

  if (!row) {
    throw new AppError({ status: 404, code: "api.cards.not_found" });
  }
}
