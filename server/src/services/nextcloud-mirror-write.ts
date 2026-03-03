import type Database from "better-sqlite3";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { getNextcloudCredentials } from "./auth-store";
import { NextcloudClient } from "./nextcloud-client";
import {
  getUserCardsMirrorPath,
  toRemotePathFromLocal
} from "./nextcloud-sync";
import { logger } from "../utils/logger";

function isPathInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  if (!rel) return true;
  if (rel.startsWith("..")) return false;
  return !isAbsolute(rel);
}

async function getUserNextcloudContext(
  db: Database.Database,
  userId: string
): Promise<{
  client: NextcloudClient;
  remoteFolder: string;
  localRoot: string;
} | null> {
  const creds = await getNextcloudCredentials(db, userId);
  if (!creds) return null;
  return {
    client: new NextcloudClient(creds.baseUrl, creds.username, creds.accessToken),
    remoteFolder: creds.remoteFolder,
    localRoot: getUserCardsMirrorPath(userId)
  };
}

export async function uploadLocalMirrorFileToNextcloud(input: {
  db: Database.Database;
  userId: string;
  localPath: string;
}): Promise<void> {
  const ctx = await getUserNextcloudContext(input.db, input.userId);
  if (!ctx) return;
  if (!isPathInside(ctx.localRoot, input.localPath)) return;

  const remotePath = toRemotePathFromLocal({
    localPath: input.localPath,
    localRoot: ctx.localRoot,
    remoteFolder: ctx.remoteFolder
  });
  if (!remotePath) return;

  const remoteDir = dirname(remotePath).replace(/\\/g, "/");
  await ctx.client.ensureFolderExists(remoteDir);
  const content = await readFile(input.localPath);
  await ctx.client.uploadFile(remotePath, content, "image/png");
}

export async function deleteLocalMirrorFileFromNextcloud(input: {
  db: Database.Database;
  userId: string;
  localPath: string;
}): Promise<void> {
  const ctx = await getUserNextcloudContext(input.db, input.userId);
  if (!ctx) return;
  if (!isPathInside(ctx.localRoot, input.localPath)) return;

  const remotePath = toRemotePathFromLocal({
    localPath: input.localPath,
    localRoot: ctx.localRoot,
    remoteFolder: ctx.remoteFolder
  });
  if (!remotePath) return;

  await ctx.client.deleteFile(remotePath);
}

export async function syncLocalMirrorChangesToNextcloud(input: {
  db: Database.Database;
  userId: string | null;
  uploadPaths?: string[];
  deletePaths?: string[];
}): Promise<void> {
  const userId = (input.userId ?? "").trim();
  if (!userId) return;

  const uploadPaths = Array.from(new Set((input.uploadPaths ?? []).filter(Boolean)));
  const deletePaths = Array.from(new Set((input.deletePaths ?? []).filter(Boolean)));

  for (const path of uploadPaths) {
    try {
      await uploadLocalMirrorFileToNextcloud({
        db: input.db,
        userId,
        localPath: path
      });
    } catch (error) {
      logger.warn("Failed to upload mirror file to Nextcloud", {
        userId,
        path,
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const path of deletePaths) {
    try {
      await deleteLocalMirrorFileFromNextcloud({
        db: input.db,
        userId,
        localPath: path
      });
    } catch (error) {
      logger.warn("Failed to delete mirror file in Nextcloud", {
        userId,
        path,
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
