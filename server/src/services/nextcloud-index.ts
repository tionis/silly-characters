import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { posix as pathPosix } from "node:path";
import { createDatabaseService } from "./database";
import { createTagService } from "./tags";
import { LorebooksService } from "./lorebooks";
import { CardParser } from "./card-parser";
import { computeContentHash } from "./card-hash";
import { deleteThumbnail, generateThumbnailFromBuffer } from "./thumbnail";
import { logger } from "../utils/logger";
import {
  getNextcloudUserContext,
  listAllRemoteEntries,
  toNextcloudVirtualPath,
} from "./nextcloud-storage";
import { updateNextcloudLastSync } from "./auth-store";

export type NextcloudIndexResult = {
  indexed: number;
  skipped: number;
  removed: number;
  totalRemotePng: number;
};

function parseRemoteTimestamp(lastModified: string | null): number {
  if (!lastModified) return Date.now();
  const parsed = Date.parse(lastModified);
  if (!Number.isFinite(parsed) || parsed <= 0) return Date.now();
  return parsed;
}

function normalizeStringArrayToText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts = value
    .map((v) => (typeof v === "string" ? v : String(v)))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  return parts.join("\n");
}

async function deleteCardThumbnailByPath(avatarPath: string | null): Promise<void> {
  const uuid = (avatarPath ?? "").split("/").pop()?.replace(".webp", "") ?? "";
  if (!uuid) return;
  await deleteThumbnail(uuid).catch(() => undefined);
}

function cleanupOrphanCard(db: Database.Database, cardId: string): string | null {
  const countRow = db
    .prepare(`SELECT COUNT(*) as cnt FROM card_files WHERE card_id = ?`)
    .get(cardId) as { cnt: number } | undefined;
  if ((countRow?.cnt ?? 0) > 0) return null;

  const cardRow = db
    .prepare(`SELECT avatar_path FROM cards WHERE id = ? LIMIT 1`)
    .get(cardId) as { avatar_path: string | null } | undefined;

  db.prepare(`DELETE FROM cards WHERE id = ?`).run(cardId);
  return cardRow?.avatar_path ?? null;
}

export async function syncUserNextcloudIndex(input: {
  db: Database.Database;
  userId: string;
}): Promise<NextcloudIndexResult> {
  const { db, userId } = input;
  const ctx = await getNextcloudUserContext(db, userId);
  await ctx.client.ensureFolderExists(ctx.remoteFolder);

  const parser = new CardParser();
  const dbService = createDatabaseService(db);
  const lorebooks = new LorebooksService(dbService);
  const tagService = createTagService(db);

  const remoteEntries = await listAllRemoteEntries(ctx.client, ctx.remoteFolder);
  const remotePngs = remoteEntries.filter(
    (entry) =>
      !entry.isDirectory && entry.remotePath.toLowerCase().endsWith(".png")
  );

  const existingRows = db
    .prepare(
      `
      SELECT cf.file_path, cf.card_id, cf.remote_etag, cf.file_mtime, cf.file_size
      FROM card_files cf
      JOIN cards c ON c.id = cf.card_id
      WHERE c.library_id = ?
    `
    )
    .all(ctx.libraryId) as Array<{
    file_path: string;
    card_id: string;
    remote_etag: string | null;
    file_mtime: number;
    file_size: number;
  }>;

  const existingByPath = new Map(existingRows.map((row) => [row.file_path, row]));
  const seenVirtualPaths = new Set<string>();
  const avatarsToDelete = new Set<string>();

  let indexed = 0;
  let skipped = 0;

  for (const remote of remotePngs) {
    const virtualPath = toNextcloudVirtualPath(ctx.userId, remote.remotePath);
    seenVirtualPaths.add(virtualPath);

    const remoteMtime = parseRemoteTimestamp(remote.lastModified);
    const remoteSize =
      typeof remote.contentLength === "number" && Number.isFinite(remote.contentLength)
        ? Math.max(0, Math.floor(remote.contentLength))
        : 0;
    const existing = existingByPath.get(virtualPath);

    const unchangedByEtag =
      !!remote.etag &&
      !!existing &&
      String(existing.remote_etag ?? "").trim() === String(remote.etag).trim();
    const unchangedByMeta =
      !remote.etag &&
      !!existing &&
      existing.file_mtime === remoteMtime &&
      existing.file_size === remoteSize;
    if (unchangedByEtag || unchangedByMeta) {
      skipped += 1;
      continue;
    }

    const fileBuffer = await ctx.client.downloadFile(remote.remotePath);
    const parsed = parser.parseBuffer(fileBuffer, remote.remotePath);
    if (!parsed) {
      logger.warn("Skipping Nextcloud file: failed to parse character card", {
        userId: ctx.userId,
        remotePath: remote.remotePath,
      });
      skipped += 1;
      continue;
    }

    const contentHash = computeContentHash(parsed.original_data);
    const existingByHash = db
      .prepare(
        `
        SELECT id, avatar_path
        FROM cards
        WHERE library_id = ? AND content_hash = ?
        LIMIT 1
      `
      )
      .get(ctx.libraryId, contentHash) as
      | { id: string; avatar_path: string | null }
      | undefined;

    const previousCardId = existing?.card_id ?? null;
    const cardId = existingByHash?.id ?? previousCardId ?? randomUUID();
    const cardRow = db
      .prepare(`SELECT avatar_path FROM cards WHERE id = ? LIMIT 1`)
      .get(cardId) as { avatar_path: string | null } | undefined;

    const avatarPath =
      cardRow?.avatar_path ?? (await generateThumbnailFromBuffer(fileBuffer, cardId));

    const name = parsed.name || null;
    const description = parsed.description || null;
    const normalizedTags = (parsed.tags || [])
      .map((t) => (typeof t === "string" ? t : String(t)))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const tags = normalizedTags.length > 0 ? JSON.stringify(normalizedTags) : null;
    const creator = parsed.creator || null;
    const specVersion = parsed.spec_version;
    const personality = parsed.personality || null;
    const scenario = parsed.scenario || null;
    const firstMes = parsed.first_mes || null;
    const mesExample = parsed.mes_example || null;
    const creatorNotes = parsed.creator_notes || null;
    const systemPrompt = parsed.system_prompt || null;
    const postHistoryInstructions = parsed.post_history_instructions || null;
    const promptTokensEst = (() => {
      const parts: string[] = [];
      const pushIf = (value: unknown) => {
        if (typeof value !== "string") return;
        const normalized = value.trim();
        if (!normalized) return;
        parts.push(normalized);
      };
      pushIf(parsed.name);
      pushIf(parsed.description);
      pushIf(parsed.personality);
      pushIf(parsed.scenario);
      pushIf(parsed.system_prompt);
      pushIf(parsed.post_history_instructions);
      pushIf(parsed.first_mes);
      pushIf(parsed.mes_example);
      const text = parts.join("\n\n");
      if (!text) return 0;
      return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
    })();
    const hasCreatorNotes = creatorNotes?.trim() ? 1 : 0;
    const hasSystemPrompt = systemPrompt?.trim() ? 1 : 0;
    const hasPostHistoryInstructions = postHistoryInstructions?.trim() ? 1 : 0;
    const hasPersonality = personality?.trim() ? 1 : 0;
    const hasScenario = scenario?.trim() ? 1 : 0;
    const hasMesExample = mesExample?.trim() ? 1 : 0;
    const hasCharacterBook = parsed.character_book ? 1 : 0;
    const alternateGreetingsCount = Array.isArray(parsed.alternate_greetings)
      ? parsed.alternate_greetings
          .map((v) => String(v ?? "").trim())
          .filter((v) => v.length > 0).length
      : 0;
    const alternateGreetingsText = normalizeStringArrayToText(
      parsed.alternate_greetings
    );
    const groupOnlyGreetingsText = normalizeStringArrayToText(
      (parsed as any).group_only_greetings
    );

    if (normalizedTags.length > 0) {
      tagService.ensureTagsExist(normalizedTags);
    }
    const tagRawNames = normalizedTags.map((tag) => tag.toLowerCase());
    const dataJson = JSON.stringify(parsed.original_data);
    const createdAt = remoteMtime;
    const fileBirthtime = remoteMtime;
    const fileFolder = pathPosix.dirname(virtualPath);
    const remoteEtag = typeof remote.etag === "string" ? remote.etag.trim() : null;

    db.transaction(() => {
      const existsCard = db
        .prepare(`SELECT 1 as one FROM cards WHERE id = ? LIMIT 1`)
        .get(cardId) as { one: number } | undefined;

      if (existsCard) {
        db.prepare(
          `
          UPDATE cards
          SET
            library_id = ?,
            is_sillytavern = 0,
            is_fav = ?,
            content_hash = ?,
            name = ?,
            description = ?,
            tags = ?,
            creator = ?,
            spec_version = ?,
            avatar_path = ?,
            created_at = ?,
            data_json = ?,
            personality = ?,
            scenario = ?,
            first_mes = ?,
            mes_example = ?,
            creator_notes = ?,
            system_prompt = ?,
            post_history_instructions = ?,
            alternate_greetings_text = ?,
            group_only_greetings_text = ?,
            alternate_greetings_count = ?,
            has_creator_notes = ?,
            has_system_prompt = ?,
            has_post_history_instructions = ?,
            has_personality = ?,
            has_scenario = ?,
            has_mes_example = ?,
            has_character_book = ?,
            prompt_tokens_est = ?
          WHERE id = ?
        `
        ).run(
          ctx.libraryId,
          parsed.fav ? 1 : 0,
          contentHash,
          name,
          description,
          tags,
          creator,
          specVersion,
          avatarPath,
          createdAt,
          dataJson,
          personality,
          scenario,
          firstMes,
          mesExample,
          creatorNotes,
          systemPrompt,
          postHistoryInstructions,
          alternateGreetingsText,
          groupOnlyGreetingsText,
          alternateGreetingsCount,
          hasCreatorNotes,
          hasSystemPrompt,
          hasPostHistoryInstructions,
          hasPersonality,
          hasScenario,
          hasMesExample,
          hasCharacterBook,
          promptTokensEst,
          cardId
        );
      } else {
        db.prepare(
          `
          INSERT INTO cards (
            id,
            library_id,
            is_sillytavern,
            is_fav,
            content_hash,
            name,
            description,
            tags,
            creator,
            spec_version,
            avatar_path,
            created_at,
            data_json,
            personality,
            scenario,
            first_mes,
            mes_example,
            creator_notes,
            system_prompt,
            post_history_instructions,
            alternate_greetings_text,
            group_only_greetings_text,
            alternate_greetings_count,
            has_creator_notes,
            has_system_prompt,
            has_post_history_instructions,
            has_personality,
            has_scenario,
            has_mes_example,
            has_character_book,
            prompt_tokens_est
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          cardId,
          ctx.libraryId,
          0,
          parsed.fav ? 1 : 0,
          contentHash,
          name,
          description,
          tags,
          creator,
          specVersion,
          avatarPath,
          createdAt,
          dataJson,
          personality,
          scenario,
          firstMes,
          mesExample,
          creatorNotes,
          systemPrompt,
          postHistoryInstructions,
          alternateGreetingsText,
          groupOnlyGreetingsText,
          alternateGreetingsCount,
          hasCreatorNotes,
          hasSystemPrompt,
          hasPostHistoryInstructions,
          hasPersonality,
          hasScenario,
          hasMesExample,
          hasCharacterBook,
          promptTokensEst
        );
      }

      db.prepare(
        `
        INSERT INTO card_files (
          file_path,
          card_id,
          file_mtime,
          file_birthtime,
          file_size,
          folder_path,
          st_profile_handle,
          st_avatar_file,
          st_avatar_base,
          st_chats_folder_path,
          st_chats_count,
          st_last_chat_at,
          st_first_chat_at,
          remote_etag
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          card_id = excluded.card_id,
          file_mtime = excluded.file_mtime,
          file_birthtime = excluded.file_birthtime,
          file_size = excluded.file_size,
          folder_path = excluded.folder_path,
          st_profile_handle = NULL,
          st_avatar_file = NULL,
          st_avatar_base = NULL,
          st_chats_folder_path = NULL,
          st_chats_count = 0,
          st_last_chat_at = 0,
          st_first_chat_at = 0,
          remote_etag = excluded.remote_etag
      `
      ).run(
        virtualPath,
        cardId,
        remoteMtime,
        fileBirthtime,
        remoteSize,
        fileFolder,
        remoteEtag
      );

      db.prepare(`DELETE FROM card_tags WHERE card_id = ?`).run(cardId);
      for (const rawName of tagRawNames) {
        db.prepare(
          `INSERT OR IGNORE INTO card_tags (card_id, tag_rawName) VALUES (?, ?)`
        ).run(cardId, rawName);
      }
    })();

    if (parsed.character_book) {
      lorebooks.upsertFromCharacterBook({
        cardId,
        characterBook: parsed.character_book,
        now: remoteMtime,
      });
    } else {
      lorebooks.detachCard(cardId);
    }

    if (previousCardId && previousCardId !== cardId) {
      const avatar = cleanupOrphanCard(db, previousCardId);
      if (avatar) avatarsToDelete.add(avatar);
    }

    indexed += 1;
  }

  const removedRows = existingRows.filter((row) => !seenVirtualPaths.has(row.file_path));
  for (const row of removedRows) {
    db.prepare(`DELETE FROM card_files WHERE file_path = ?`).run(row.file_path);
    const avatar = cleanupOrphanCard(db, row.card_id);
    if (avatar) avatarsToDelete.add(avatar);
  }

  for (const avatar of avatarsToDelete) {
    await deleteCardThumbnailByPath(avatar);
  }

  updateNextcloudLastSync(db, ctx.userId, Date.now());

  return {
    indexed,
    skipped,
    removed: removedRows.length,
    totalRemotePng: remotePngs.length,
  };
}
