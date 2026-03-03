import { ensureDir, readdir, remove, writeFile } from "fs-extra";
import { dirname, join, relative } from "node:path";
import { NextcloudClient, normalizeRemoteFolder } from "./nextcloud-client";

function userMirrorRoot(userId: string): string {
  return join(process.cwd(), "data", "users", userId, "cards");
}

function relativeRemotePath(remoteFolder: string, remotePath: string): string | null {
  const folder = normalizeRemoteFolder(remoteFolder);
  if (folder === "/") {
    const normalized = remotePath.startsWith("/") ? remotePath.slice(1) : remotePath;
    return normalized.length > 0 ? normalized : null;
  }
  if (remotePath === folder) return null;
  if (!remotePath.startsWith(`${folder}/`)) return null;
  return remotePath.slice(folder.length + 1);
}

async function listAllRemoteEntries(
  client: NextcloudClient,
  remoteFolder: string
): Promise<Array<{ remotePath: string; isDirectory: boolean }>> {
  const root = normalizeRemoteFolder(remoteFolder);
  const queue = [root];
  const visited = new Set<string>();
  const result: Array<{ remotePath: string; isDirectory: boolean }> = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const entries = await client.listFolder(current);
    for (const entry of entries) {
      result.push({ remotePath: entry.remotePath, isDirectory: entry.isDirectory });
      if (entry.isDirectory) {
        queue.push(entry.remotePath);
      }
    }
  }

  return result;
}

async function listLocalPngFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const name of entries) {
      const fullPath = join(dir, name);
      if (name.startsWith(".")) continue;
      if (name.toLowerCase().endsWith(".png")) {
        out.push(fullPath);
        continue;
      }
      await walk(fullPath);
    }
  }

  await walk(rootDir);
  return out;
}

export function getUserCardsMirrorPath(userId: string): string {
  return userMirrorRoot(userId);
}

export async function syncNextcloudPngsToLocalMirror(input: {
  userId: string;
  client: NextcloudClient;
  remoteFolder: string;
}): Promise<{ downloaded: number; removed: number; totalRemotePng: number }> {
  const localRoot = userMirrorRoot(input.userId);
  await ensureDir(localRoot);
  await input.client.ensureFolderExists(input.remoteFolder);

  const entries = await listAllRemoteEntries(input.client, input.remoteFolder);
  const remotePngs = entries.filter(
    (entry) =>
      !entry.isDirectory &&
      entry.remotePath.toLowerCase().endsWith(".png")
  );

  const expectedLocalSet = new Set<string>();
  let downloaded = 0;

  for (const remote of remotePngs) {
    const rel = relativeRemotePath(input.remoteFolder, remote.remotePath);
    if (!rel) continue;
    const sanitized = rel.replace(/^\/+/, "");
    if (!sanitized || sanitized.includes("..")) continue;
    const localPath = join(localRoot, sanitized);
    expectedLocalSet.add(localPath);

    const binary = await input.client.downloadFile(remote.remotePath);
    await ensureDir(dirname(localPath));
    await writeFile(localPath, binary);
    downloaded += 1;
  }

  const existingLocalPngs = await listLocalPngFiles(localRoot);
  let removed = 0;
  for (const localPath of existingLocalPngs) {
    if (expectedLocalSet.has(localPath)) continue;
    await remove(localPath);
    removed += 1;
  }

  return {
    downloaded,
    removed,
    totalRemotePng: remotePngs.length
  };
}

export function toRemotePathFromLocal(input: {
  localPath: string;
  localRoot: string;
  remoteFolder: string;
}): string | null {
  const rel = relative(input.localRoot, input.localPath).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return null;
  const folder = normalizeRemoteFolder(input.remoteFolder);
  return folder === "/" ? `/${rel}` : `${folder}/${rel}`;
}
