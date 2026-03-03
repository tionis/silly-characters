import { z } from "zod";
import {
  NextcloudClient,
  normalizeBaseUrl,
  normalizeRemoteFolder
} from "./nextcloud-client";

const SETTINGS_FILE_NAME = ".sillycharacters.json";
const LEGACY_SETTINGS_FILE_NAME = ".sillyinnkeeper.json";

const settingsSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().datetime({ offset: true }),
  profile: z.object({
    displayName: z.string().trim().min(1).max(120),
    email: z.union([z.string().trim().email(), z.null()])
  }),
  connection: z.object({
    baseUrl: z.string().trim().url(),
    username: z.string().trim().min(1).max(200),
    remoteFolder: z.string().trim().min(1),
    lastSyncAt: z.union([z.string().datetime({ offset: true }), z.null()])
  })
});

export type NextcloudSettings = {
  version: 1;
  updatedAt: string;
  profile: {
    displayName: string;
    email: string | null;
  };
  connection: {
    baseUrl: string;
    username: string;
    remoteFolder: string;
    lastSyncAt: string | null;
  };
};

function buildSettingsFilePath(
  remoteFolder: string,
  fileName = SETTINGS_FILE_NAME
): string {
  const folder = normalizeRemoteFolder(remoteFolder);
  return folder === "/" ? `/${fileName}` : `${folder}/${fileName}`;
}

export async function readNextcloudSettings(
  client: NextcloudClient,
  remoteFolder: string
): Promise<NextcloudSettings | null> {
  let raw = await client.readJsonFile<unknown>(buildSettingsFilePath(remoteFolder));
  if (raw === null) {
    raw = await client.readJsonFile<unknown>(
      buildSettingsFilePath(remoteFolder, LEGACY_SETTINGS_FILE_NAME)
    );
    if (raw === null) return null;
  }

  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid Nextcloud settings file format");
  }

  return {
    version: 1,
    updatedAt: parsed.data.updatedAt,
    profile: {
      displayName: parsed.data.profile.displayName.trim(),
      email: parsed.data.profile.email
    },
    connection: {
      baseUrl: normalizeBaseUrl(parsed.data.connection.baseUrl),
      username: parsed.data.connection.username.trim(),
      remoteFolder: normalizeRemoteFolder(parsed.data.connection.remoteFolder),
      lastSyncAt: parsed.data.connection.lastSyncAt
    }
  };
}

export async function writeNextcloudSettings(
  client: NextcloudClient,
  input: {
    profile: {
      displayName: string;
      email: string | null;
    };
    connection: {
      baseUrl: string;
      username: string;
      remoteFolder: string;
      lastSyncAt: string | null;
    };
  }
): Promise<NextcloudSettings> {
  await client.ensureFolderExists(input.connection.remoteFolder);

  const payload: NextcloudSettings = {
    version: 1,
    updatedAt: new Date().toISOString(),
    profile: {
      displayName: input.profile.displayName.trim(),
      email: input.profile.email?.trim() ?? null
    },
    connection: {
      baseUrl: normalizeBaseUrl(input.connection.baseUrl),
      username: input.connection.username.trim(),
      remoteFolder: normalizeRemoteFolder(input.connection.remoteFolder),
      lastSyncAt: input.connection.lastSyncAt
    }
  };

  await client.writeJsonFile(buildSettingsFilePath(payload.connection.remoteFolder), payload);
  return payload;
}
