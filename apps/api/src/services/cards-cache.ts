import { randomUUID } from "node:crypto";
import { db } from "../db/client";
import type { CardCacheRow } from "../types";
import type { NextcloudDavEntry } from "./nextcloud-client";

export type CardListItem = {
  id: string;
  remotePath: string;
  name: string;
  tags: string[];
  etag: string | null;
  contentLength: number | null;
  lastModified: string | null;
  updatedAt: string;
};

function deriveCardName(remotePath: string): string {
  const base = remotePath.split("/").filter(Boolean).pop() ?? remotePath;
  return base.replace(/\.png$/i, "");
}

export function listCardsForUser(userId: string): CardListItem[] {
  const rows = db
    .prepare(
      `
        SELECT id, user_id, remote_path, name, tags_json, etag, content_length, last_modified, updated_at
        FROM cards_cache
        WHERE user_id = ?
        ORDER BY updated_at DESC, name COLLATE NOCASE ASC
      `
    )
    .all(userId) as CardCacheRow[];

  return rows.map((row) => {
    const tags = (() => {
      try {
        const parsed = JSON.parse(row.tags_json) as unknown;
        return Array.isArray(parsed)
          ? parsed.map((tag) => String(tag)).filter((tag) => tag.trim().length > 0)
          : [];
      } catch {
        return [];
      }
    })();

    return {
      id: row.id,
      remotePath: row.remote_path,
      name: row.name,
      tags,
      etag: row.etag,
      contentLength: row.content_length,
      lastModified: row.last_modified,
      updatedAt: new Date(row.updated_at).toISOString()
    };
  });
}

export function clearCardsForUser(userId: string): void {
  db.prepare("DELETE FROM cards_cache WHERE user_id = ?").run(userId);
}

export function syncCardsCacheForUser(userId: string, entries: NextcloudDavEntry[]): {
  scannedFiles: number;
  upsertedCards: number;
  removedCards: number;
} {
  const files = entries.filter(
    (entry) => !entry.isDirectory && entry.remotePath.toLowerCase().endsWith(".png")
  );
  const now = Date.now();

  const existingRows = db
    .prepare(
      `
        SELECT remote_path
        FROM cards_cache
        WHERE user_id = ?
      `
    )
    .all(userId) as Array<{ remote_path: string }>;
  const existingPathSet = new Set(existingRows.map((row) => row.remote_path));
  const incomingPathSet = new Set(files.map((entry) => entry.remotePath));

  const upsert = db.prepare(
    `
      INSERT INTO cards_cache (
        id,
        user_id,
        remote_path,
        name,
        tags_json,
        etag,
        content_length,
        last_modified,
        updated_at
      )
      VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?)
      ON CONFLICT(user_id, remote_path) DO UPDATE SET
        name = excluded.name,
        etag = excluded.etag,
        content_length = excluded.content_length,
        last_modified = excluded.last_modified,
        updated_at = excluded.updated_at
    `
  );
  const remove = db.prepare(
    `
      DELETE FROM cards_cache
      WHERE user_id = ?
        AND remote_path = ?
    `
  );

  let removedCards = 0;
  db.transaction(() => {
    for (const file of files) {
      upsert.run(
        randomUUID(),
        userId,
        file.remotePath,
        deriveCardName(file.remotePath),
        file.etag,
        file.contentLength,
        file.lastModified,
        now
      );
    }

    for (const oldPath of existingPathSet) {
      if (incomingPathSet.has(oldPath)) continue;
      remove.run(userId, oldPath);
      removedCards += 1;
    }
  })();

  return {
    scannedFiles: files.length,
    upsertedCards: files.length,
    removedCards
  };
}
