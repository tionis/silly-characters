import { Hono } from "hono";
import type { AppEnv } from "../lib/app-env";
import { listCardsForUser, syncCardsCacheForUser } from "../services/cards-cache";
import { NextcloudClient } from "../services/nextcloud-client";
import {
  getNextcloudCredentials,
  updateNextcloudLastSync
} from "../services/nextcloud-connections";
import {
  readNextcloudSettings,
  writeNextcloudSettings
} from "../services/nextcloud-settings";
import { logger } from "../lib/logger";

export const cardsRoutes = new Hono<AppEnv>()
  .get("/", (c) => {
    const user = c.get("currentUser");
    const items = listCardsForUser(user.id);
    return c.json({ items, total: items.length });
  })
  .post("/sync", async (c) => {
    const user = c.get("currentUser");
    const creds = await getNextcloudCredentials(user.id);
    if (!creds) {
      return c.json({ ok: false, error: "nextcloud_not_connected" }, 401);
    }

    const client = new NextcloudClient(creds.baseUrl, creds.username, creds.auth);

    try {
      const entries = await client.listFolder(creds.remoteFolder);
      const result = syncCardsCacheForUser(user.id, entries);
      const syncedAtMs = Date.now();
      updateNextcloudLastSync(user.id, syncedAtMs);

      let metadataWarning: string | null = null;
      const syncedAtIso = new Date(syncedAtMs).toISOString();
      try {
        const existingSettings = await readNextcloudSettings(
          client,
          creds.remoteFolder
        );
        await writeNextcloudSettings(client, {
          profile: existingSettings?.profile ?? {
            displayName: user.displayName,
            email: user.email
          },
          connection: {
            baseUrl: creds.baseUrl,
            username: creds.username,
            remoteFolder: creds.remoteFolder,
            lastSyncAt: syncedAtIso
          }
        });
      } catch (error) {
        metadataWarning =
          error instanceof Error ? error.message : String(error);
        logger.warn("Cards synced but Nextcloud settings update failed", {
          userId: user.id,
          details: metadataWarning
        });
      }

      return c.json({
        ok: true,
        ...result,
        metadataWarning
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: "cards_sync_failed",
          details: error instanceof Error ? error.message : String(error)
        },
        500
      );
    }
  });
