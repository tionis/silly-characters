import type Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { remove } from "fs-extra";
import { logger } from "../utils/logger";

export interface CacheGcOptions {
  intervalMs?: number;
  minUnreferencedAgeMs?: number;
  initialDelayMs?: number;
}

export interface CacheGcResult {
  scannedUsers: number;
  scannedFiles: number;
  removedFiles: number;
  removedDirs: number;
  skippedYoungFiles: number;
  errors: number;
  durationMs: number;
}

export interface CacheGcController {
  stop: () => void;
  runNow: () => Promise<CacheGcResult | null>;
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_MIN_UNREFERENCED_AGE_MS = 60 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 30 * 1000;

function isPathInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (!rel) return true;
  if (rel.startsWith("..")) return false;
  return !isAbsolute(rel);
}

async function collectPngFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];

  const walk = async (dirPath: string): Promise<void> => {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = resolve(join(dirPath, entry.name));
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(".png")) continue;
      out.push(fullPath);
    }
  };

  await walk(rootDir);
  return out;
}

async function pruneEmptyDirectories(rootDir: string): Promise<number> {
  let removedDirs = 0;

  const walk = async (dirPath: string): Promise<boolean> => {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const childPath = resolve(join(dirPath, entry.name));
      const isEmpty = await walk(childPath);
      if (!isEmpty) continue;
      try {
        await remove(childPath);
        removedDirs += 1;
      } catch {
        // ignore race / permission issues here; file removal stats capture hard failures.
      }
    }

    const left = await readdir(dirPath);
    return left.length === 0;
  };

  if (!existsSync(rootDir)) return 0;
  await walk(rootDir);
  return removedDirs;
}

function getReferencedCardFiles(
  db: Database.Database,
  usersRoot: string
): Set<string> {
  const rows = db.prepare(`SELECT file_path FROM card_files`).all() as Array<{
    file_path: string;
  }>;

  const set = new Set<string>();
  for (const row of rows) {
    const filePath =
      typeof row.file_path === "string" ? row.file_path.trim() : "";
    if (!filePath) continue;
    const normalized = resolve(filePath);
    if (!isPathInside(usersRoot, normalized)) continue;
    set.add(normalized);
  }
  return set;
}

export async function runCacheGcOnce(
  db: Database.Database,
  opts?: Pick<CacheGcOptions, "minUnreferencedAgeMs">
): Promise<CacheGcResult> {
  const startedAt = Date.now();
  const usersRoot = resolve(join(process.cwd(), "data", "users"));
  const minAgeMs =
    typeof opts?.minUnreferencedAgeMs === "number" &&
    Number.isFinite(opts.minUnreferencedAgeMs) &&
    opts.minUnreferencedAgeMs >= 0
      ? Math.floor(opts.minUnreferencedAgeMs)
      : DEFAULT_MIN_UNREFERENCED_AGE_MS;

  const result: Omit<CacheGcResult, "durationMs"> = {
    scannedUsers: 0,
    scannedFiles: 0,
    removedFiles: 0,
    removedDirs: 0,
    skippedYoungFiles: 0,
    errors: 0,
  };

  if (!existsSync(usersRoot)) {
    return { ...result, durationMs: Date.now() - startedAt };
  }

  const referencedFiles = getReferencedCardFiles(db, usersRoot);
  const now = Date.now();

  const userEntries = await readdir(usersRoot, { withFileTypes: true });
  for (const entry of userEntries) {
    if (!entry.isDirectory()) continue;
    const cardsRoot = resolve(join(usersRoot, entry.name, "cards"));
    if (!existsSync(cardsRoot)) continue;
    result.scannedUsers += 1;

    let pngFiles: string[] = [];
    try {
      pngFiles = await collectPngFiles(cardsRoot);
    } catch (error) {
      result.errors += 1;
      logger.warn("Cache GC failed to scan user cards cache", {
        userId: entry.name,
        details: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const filePath of pngFiles) {
      result.scannedFiles += 1;
      if (referencedFiles.has(filePath)) continue;

      try {
        const fileStat = await stat(filePath);
        if (now - fileStat.mtimeMs < minAgeMs) {
          result.skippedYoungFiles += 1;
          continue;
        }

        await remove(filePath);
        result.removedFiles += 1;
      } catch (error) {
        result.errors += 1;
        logger.warn("Cache GC failed to remove unreferenced cache file", {
          path: filePath,
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      result.removedDirs += await pruneEmptyDirectories(cardsRoot);
    } catch (error) {
      result.errors += 1;
      logger.warn("Cache GC failed to prune empty cache directories", {
        userId: entry.name,
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { ...result, durationMs: Date.now() - startedAt };
}

export function startCacheGcJob(
  db: Database.Database,
  opts?: CacheGcOptions
): CacheGcController {
  const intervalMs =
    typeof opts?.intervalMs === "number" &&
    Number.isFinite(opts.intervalMs) &&
    opts.intervalMs > 0
      ? Math.floor(opts.intervalMs)
      : DEFAULT_INTERVAL_MS;
  const minUnreferencedAgeMs =
    typeof opts?.minUnreferencedAgeMs === "number" &&
    Number.isFinite(opts.minUnreferencedAgeMs) &&
    opts.minUnreferencedAgeMs >= 0
      ? Math.floor(opts.minUnreferencedAgeMs)
      : DEFAULT_MIN_UNREFERENCED_AGE_MS;
  const initialDelayMs =
    typeof opts?.initialDelayMs === "number" &&
    Number.isFinite(opts.initialDelayMs) &&
    opts.initialDelayMs >= 0
      ? Math.floor(opts.initialDelayMs)
      : DEFAULT_INITIAL_DELAY_MS;

  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  const runNow = async (): Promise<CacheGcResult | null> => {
    if (stopped || running) return null;
    running = true;
    try {
      const result = await runCacheGcOnce(db, { minUnreferencedAgeMs });
      logger.info("Cache GC finished", result);
      return result;
    } catch (error) {
      logger.error(error, "Cache GC run failed");
      return null;
    } finally {
      running = false;
    }
  };

  const scheduleNext = (): void => {
    if (stopped) return;
    timer = setTimeout(async () => {
      await runNow();
      scheduleNext();
    }, intervalMs);
  };

  timer = setTimeout(async () => {
    await runNow();
    scheduleNext();
  }, initialDelayMs);

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    runNow,
  };
}
