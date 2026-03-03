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

export type NextcloudSettingsProfile = {
  displayName: string;
  email: string | null;
};

export type NextcloudSettingsConnection = {
  baseUrl: string;
  username: string;
  remoteFolder: string;
  lastSyncAt: string | null;
};

export type NextcloudSettings = {
  version: 1;
  updatedAt: string;
  profile: NextcloudSettingsProfile;
  connection: NextcloudSettingsConnection;
};

function buildSettingsFilePath(
  remoteFolder: string,
  fileName = SETTINGS_FILE_NAME
): string {
  const folder = normalizeRemoteFolder(remoteFolder);
  return folder === "/" ? `/${fileName}` : `${folder}/${fileName}`;
}

function toProfile(profile: NextcloudSettingsProfile): NextcloudSettingsProfile {
  const email = profile.email?.trim() ?? null;
  return {
    displayName: profile.displayName.trim(),
    email: email && email.length > 0 ? email : null
  };
}

function toConnection(
  connection: NextcloudSettingsConnection
): NextcloudSettingsConnection {
  return {
    baseUrl: normalizeBaseUrl(connection.baseUrl),
    username: connection.username.trim(),
    remoteFolder: normalizeRemoteFolder(connection.remoteFolder),
    lastSyncAt: connection.lastSyncAt
  };
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
    profile: toProfile(parsed.data.profile),
    connection: toConnection(parsed.data.connection)
  };
}

export async function writeNextcloudSettings(
  client: NextcloudClient,
  input: {
    profile: NextcloudSettingsProfile;
    connection: NextcloudSettingsConnection;
  }
): Promise<NextcloudSettings> {
  await client.ensureFolderExists(input.connection.remoteFolder);

  const filePath = buildSettingsFilePath(input.connection.remoteFolder);
  const payload: NextcloudSettings = {
    version: 1,
    updatedAt: new Date().toISOString(),
    profile: toProfile(input.profile),
    connection: toConnection(input.connection)
  };

  await client.writeJsonFile(filePath, payload);
  return payload;
}
