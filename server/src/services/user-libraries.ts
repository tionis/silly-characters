import type Database from "better-sqlite3";
import { AppError } from "../errors/app-error";
import { getOrCreateLibraryId } from "./libraries";
import { getSettingsForUser } from "./settings";
import { listSillyTavernProfileCharactersDirs } from "./sillytavern";

export async function resolveUserLibraryIds(
  db: Database.Database,
  userId: string | null
): Promise<string[]> {
  const settings = await getSettingsForUser(userId);
  const libraryIds: string[] = [];

  if (settings.cardsFolderPath) {
    libraryIds.push(getOrCreateLibraryId(db, settings.cardsFolderPath));
  }

  if (settings.sillytavenrPath) {
    const stRoot = settings.sillytavenrPath;
    const dirs = await listSillyTavernProfileCharactersDirs(stRoot);
    const perProfileLibraryIds = dirs.map((d) =>
      getOrCreateLibraryId(db, d.charactersDir)
    );

    const usePerProfile = (() => {
      if (perProfileLibraryIds.length === 0) return false;
      const placeholders = perProfileLibraryIds.map(() => "?").join(", ");
      const row = db
        .prepare(
          `
          SELECT COUNT(*) as cnt
          FROM cards
          WHERE is_sillytavern = 1
            AND library_id IN (${placeholders})
        `
        )
        .get(...perProfileLibraryIds) as { cnt: number } | undefined;
      return (row?.cnt ?? 0) > 0;
    })();

    if (usePerProfile) {
      libraryIds.push(...perProfileLibraryIds);
    } else {
      libraryIds.push(getOrCreateLibraryId(db, stRoot));
    }
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
