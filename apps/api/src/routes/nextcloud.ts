import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/app-env";
import { clearCardsForUser } from "../services/cards-cache";
import {
  deleteNextcloudConnection,
  getNextcloudConnectionStatus,
  getNextcloudCredentials,
  updateNextcloudRemoteFolder
} from "../services/nextcloud-connections";
import { NextcloudClient, normalizeRemoteFolder } from "../services/nextcloud-client";
import {
  readNextcloudSettings,
  writeNextcloudSettings
} from "../services/nextcloud-settings";

const remoteFolderSchema = z.object({
  remoteFolder: z.string().trim().min(1).max(500)
});

export const nextcloudRoutes = new Hono<AppEnv>()
  .get("/status", (c) => {
    const user = c.get("currentUser");
    return c.json(getNextcloudConnectionStatus(user.id));
  })
  .post("/connect", (c) =>
    c.json(
      {
        ok: false,
        error: "manual_connect_removed",
        message: "Use OAuth login at /api/auth/login"
      },
      410
    )
  )
  .delete("/connect", (c) => {
    const user = c.get("currentUser");
    deleteNextcloudConnection(user.id);
    clearCardsForUser(user.id);
    return c.json({ ok: true });
  })
  .put("/remote-folder", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = remoteFolderSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          ok: false,
          error: "invalid_remote_folder_payload",
          issues: parsed.error.issues
        },
        400
      );
    }

    const user = c.get("currentUser");
    const creds = await getNextcloudCredentials(user.id);
    if (!creds) {
      return c.json({ ok: false, error: "not_connected" }, 401);
    }

    const remoteFolder = normalizeRemoteFolder(parsed.data.remoteFolder);
    const client = new NextcloudClient(creds.baseUrl, creds.username, creds.auth);

    try {
      await client.ensureFolderExists(remoteFolder);
      await client.verifyAccess(remoteFolder);
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: "remote_folder_unreachable",
          details: error instanceof Error ? error.message : String(error)
        },
        400
      );
    }

    try {
      const existingSettings = await readNextcloudSettings(client, creds.remoteFolder);
      await writeNextcloudSettings(client, {
        profile: existingSettings?.profile ?? {
          displayName: user.displayName,
          email: user.email
        },
        connection: {
          baseUrl: creds.baseUrl,
          username: creds.username,
          remoteFolder,
          lastSyncAt: existingSettings?.connection.lastSyncAt ?? null
        }
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: "nextcloud_settings_write_failed",
          details: error instanceof Error ? error.message : String(error)
        },
        502
      );
    }

    updateNextcloudRemoteFolder(user.id, remoteFolder);
    return c.json({
      ok: true,
      status: getNextcloudConnectionStatus(user.id)
    });
  })
  .post("/validate", async (c) => {
    const user = c.get("currentUser");
    const creds = await getNextcloudCredentials(user.id);
    if (!creds) {
      return c.json({ ok: false, error: "not_connected" }, 401);
    }

    const client = new NextcloudClient(creds.baseUrl, creds.username, creds.auth);
    try {
      const entries = await client.listFolder(creds.remoteFolder);
      return c.json({
        ok: true,
        totalEntries: entries.length
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: "nextcloud_validate_failed",
          details: error instanceof Error ? error.message : String(error)
        },
        400
      );
    }
  });
