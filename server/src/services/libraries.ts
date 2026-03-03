import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { resolve, normalize } from "node:path";

export type LibraryRow = {
  id: string;
  folder_path: string;
  created_at: number;
  updated_at: number;
};

export function normalizeFolderPath(folderPath: string): string {
  const trimmed = folderPath.trim();
  const resolved = resolve(trimmed);
  const normalized = normalize(resolved);
  // On Windows folder paths are case-insensitive in practice.
  // Lowercase to make UNIQUE(folder_path) stable.
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function getLibraryIdByPath(
  db: Database.Database,
  folderPath: string
): string | null {
  const key = normalizeFolderPath(folderPath);
  const row = db
    .prepare(`SELECT id FROM libraries WHERE folder_path = ? LIMIT 1`)
    .get(key) as { id: string } | undefined;
  return row?.id ?? null;
}

export function getOrCreateLibraryId(
  db: Database.Database,
  folderPath: string
): string {
  const key = normalizeFolderPath(folderPath);
  const now = Date.now();

  const existing = db
    .prepare(`SELECT id FROM libraries WHERE folder_path = ? LIMIT 1`)
    .get(key) as { id: string } | undefined;
  if (existing?.id) return existing.id;

  const id = randomUUID();
  try {
    db.prepare(
      `INSERT INTO libraries (id, folder_path, created_at, updated_at) VALUES (?, ?, ?, ?)`
    ).run(id, key, now, now);
    return id;
  } catch {
    // race: another request inserted same folder_path
    const after = db
      .prepare(`SELECT id FROM libraries WHERE folder_path = ? LIMIT 1`)
      .get(key) as { id: string } | undefined;
    if (after?.id) return after.id;
    throw new Error("Failed to create library row");
  }
}
