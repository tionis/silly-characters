import type Database from "better-sqlite3";
import { posix as pathPosix } from "node:path";
import { getNextcloudCredentials } from "./auth-store";
import { getOrCreateLibraryId } from "./libraries";
import {
  NextcloudClient,
  normalizeRemoteFolder,
  normalizeRemotePath,
} from "./nextcloud-client";
import { AppError } from "../errors/app-error";

const NEXTCLOUD_VIRTUAL_ROOT = "/__nextcloud__";

function normalizeUserId(userId: string): string {
  return userId.trim();
}

function userVirtualPrefix(userId: string): string {
  const normalized = normalizeUserId(userId);
  return `${NEXTCLOUD_VIRTUAL_ROOT}/${normalized}`;
}

export function toNextcloudVirtualPath(userId: string, remotePath: string): string {
  const prefix = userVirtualPrefix(userId);
  const normalizedRemote = normalizeRemotePath(remotePath);
  if (normalizedRemote === "/") return prefix;
  return `${prefix}${normalizedRemote}`;
}

export function fromNextcloudVirtualPath(
  userId: string,
  virtualPath: string
): string | null {
  const normalizedVirtual = pathPosix
    .normalize(String(virtualPath ?? "").trim().replace(/\\/g, "/"))
    .replace(/\/+$/, "");
  const prefix = userVirtualPrefix(userId);
  if (normalizedVirtual === prefix) return "/";
  if (!normalizedVirtual.startsWith(`${prefix}/`)) return null;
  const suffix = normalizedVirtual.slice(prefix.length);
  return normalizeRemotePath(suffix);
}

export function getNextcloudLibraryFolderKey(
  userId: string,
  remoteFolder: string
): string {
  const normalized = normalizeRemoteFolder(remoteFolder);
  return `${NEXTCLOUD_VIRTUAL_ROOT}/library/${normalizeUserId(userId)}${normalized}`;
}

export function getOrCreateNextcloudLibraryId(
  db: Database.Database,
  userId: string,
  remoteFolder: string
): string {
  return getOrCreateLibraryId(
    db,
    getNextcloudLibraryFolderKey(userId, remoteFolder)
  );
}

export async function getNextcloudUserContext(
  db: Database.Database,
  userId: string
): Promise<{
  userId: string;
  client: NextcloudClient;
  remoteFolder: string;
  libraryId: string;
}> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    throw new AppError({ status: 401, code: "api.auth.unauthorized" });
  }

  const creds = await getNextcloudCredentials(db, normalizedUserId);
  if (!creds) {
    throw new AppError({ status: 401, code: "api.auth.not_authenticated" });
  }

  const remoteFolder = normalizeRemoteFolder(creds.remoteFolder);
  const libraryId = getOrCreateNextcloudLibraryId(
    db,
    normalizedUserId,
    remoteFolder
  );

  return {
    userId: normalizedUserId,
    client: new NextcloudClient(creds.baseUrl, creds.username, creds.accessToken),
    remoteFolder,
    libraryId,
  };
}

export async function listAllRemoteEntries(
  client: NextcloudClient,
  remoteFolder: string
): Promise<Array<{ remotePath: string; isDirectory: boolean; etag: string | null; contentLength: number | null; lastModified: string | null }>> {
  const root = normalizeRemoteFolder(remoteFolder);
  const queue: string[] = [root];
  const visited = new Set<string>();
  const result: Array<{
    remotePath: string;
    isDirectory: boolean;
    etag: string | null;
    contentLength: number | null;
    lastModified: string | null;
  }> = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const entries = await client.listFolder(current);
    for (const entry of entries) {
      result.push({
        remotePath: entry.remotePath,
        isDirectory: entry.isDirectory,
        etag: entry.etag,
        contentLength: entry.contentLength,
        lastModified: entry.lastModified,
      });
      if (entry.isDirectory) queue.push(entry.remotePath);
    }
  }

  return result;
}

export async function pickUniqueRemotePngPath(input: {
  client: NextcloudClient;
  folder: string;
  baseName: string;
}): Promise<string> {
  const folder = normalizeRemoteFolder(input.folder);
  const entries = await input.client.listFolder(folder);
  const names = new Set(entries.filter((e) => !e.isDirectory).map((e) => e.name.toLowerCase()));

  const base = input.baseName.trim();
  const first = `${base}.png`;
  if (!names.has(first.toLowerCase())) {
    return folder === "/" ? `/${first}` : `${folder}/${first}`;
  }

  for (let i = 1; i < 1000; i += 1) {
    const name = `${base} (${i}).png`;
    if (!names.has(name.toLowerCase())) {
      return folder === "/" ? `/${name}` : `${folder}/${name}`;
    }
  }

  const fallback = `${base} (${Date.now()}).png`;
  return folder === "/" ? `/${fallback}` : `${folder}/${fallback}`;
}
