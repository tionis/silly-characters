import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../lib/app-env";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { SESSION_COOKIE } from "../middleware/session";
import {
  deleteSession,
  setSessionUser,
  updateCurrentUser
} from "../services/auth";
import {
  buildNextcloudAuthorizeUrl,
  exchangeCodeForToken,
  fetchNextcloudOAuthUser,
  getOAuthBaseUrl
} from "../services/nextcloud-oauth";
import { consumeOauthState, createOauthState } from "../services/oauth-state";
import {
  deleteNextcloudConnection,
  findUserIdByNextcloudIdentity,
  getNextcloudConnectionStatus,
  getNextcloudCredentials,
  upsertNextcloudOAuthConnection,
  updateNextcloudLastSync,
  updateNextcloudRemoteFolder
} from "../services/nextcloud-connections";
import { NextcloudClient } from "../services/nextcloud-client";
import {
  readNextcloudSettings,
  writeNextcloudSettings
} from "../services/nextcloud-settings";
import { clearCardsForUser } from "../services/cards-cache";

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z.union([z.string().trim().email(), z.literal(""), z.null()]).optional()
});

export const authRoutes = new Hono<AppEnv>()
  .get("/me", (c) => {
    const user = c.get("currentUser");
    const connection = getNextcloudConnectionStatus(user.id);
    const authenticated = connection.connected;

    return c.json({
      authenticated,
      user: authenticated ? user : null,
      nextcloud: connection,
      loginPath: "/api/auth/login"
    });
  })
  .get("/login-url", (c) => {
    const sessionId = c.get("sessionId");
    const state = createOauthState(sessionId);

    try {
      return c.json({
        ok: true,
        url: buildNextcloudAuthorizeUrl(state)
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: "oauth_not_configured",
          details: error instanceof Error ? error.message : String(error)
        },
        500
      );
    }
  })
  .get("/login", (c) => {
    const sessionId = c.get("sessionId");
    const state = createOauthState(sessionId);

    try {
      return c.redirect(buildNextcloudAuthorizeUrl(state), 302);
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: "oauth_not_configured",
          details: error instanceof Error ? error.message : String(error)
        },
        500
      );
    }
  })
  .get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const oauthError = c.req.query("error");

    if (oauthError) {
      return c.redirect(
        `${env.WEB_ORIGIN}/?auth_error=${encodeURIComponent(oauthError)}`,
        302
      );
    }
    if (!code || !state) {
      return c.redirect(
        `${env.WEB_ORIGIN}/?auth_error=missing_code_or_state`,
        302
      );
    }

    const sessionIdFromState = consumeOauthState(state);
    const currentSessionId = c.get("sessionId");
    if (!sessionIdFromState || sessionIdFromState !== currentSessionId) {
      return c.redirect(
        `${env.WEB_ORIGIN}/?auth_error=invalid_or_expired_state`,
        302
      );
    }

    try {
      const token = await exchangeCodeForToken(code);
      const oauthUser = await fetchNextcloudOAuthUser(token.accessToken);
      const baseUrl = getOAuthBaseUrl();

      const currentUser = c.get("currentUser");
      const existingUserId = findUserIdByNextcloudIdentity(
        baseUrl,
        oauthUser.nextcloudUserId
      );
      const userId = existingUserId ?? currentUser.id;
      if (existingUserId && existingUserId !== currentUser.id) {
        setSessionUser(currentSessionId, existingUserId);
      }

      let resolvedUser = updateCurrentUser(userId, {
        displayName: oauthUser.displayName,
        email: oauthUser.email
      });

      const previousStatus = getNextcloudConnectionStatus(userId);
      const remoteFolder = previousStatus.remoteFolder ?? "/characters";

      upsertNextcloudOAuthConnection({
        userId,
        baseUrl,
        username: oauthUser.nextcloudUserId,
        nextcloudUserId: oauthUser.nextcloudUserId,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        tokenExpiresAtMs: token.tokenExpiresAtMs,
        scope: token.scope,
        remoteFolder,
        lastSyncAt: previousStatus.lastSyncAt
      });

      // Best effort: hydrate from Nextcloud settings if present, otherwise create it.
      try {
        const creds = await getNextcloudCredentials(userId);
        if (creds) {
          const client = new NextcloudClient(
            creds.baseUrl,
            creds.username,
            creds.auth
          );
          const settings = await readNextcloudSettings(client, creds.remoteFolder);

          if (settings) {
            resolvedUser = updateCurrentUser(userId, settings.profile);
            updateNextcloudRemoteFolder(userId, settings.connection.remoteFolder);
            if (settings.connection.lastSyncAt) {
              const syncedAtMs = Date.parse(settings.connection.lastSyncAt);
              if (Number.isFinite(syncedAtMs)) {
                updateNextcloudLastSync(userId, syncedAtMs);
              }
            }
          } else {
            await writeNextcloudSettings(client, {
              profile: resolvedUser,
              connection: {
                baseUrl: creds.baseUrl,
                username: creds.username,
                remoteFolder: creds.remoteFolder,
                lastSyncAt: previousStatus.lastSyncAt
              }
            });
          }
        }
      } catch (error) {
        logger.warn("OAuth login succeeded but Nextcloud settings sync failed", {
          userId,
          details: error instanceof Error ? error.message : String(error)
        });
      }

      c.set("currentUser", resolvedUser);
      return c.redirect(`${env.WEB_ORIGIN}/?auth=success`, 302);
    } catch (error) {
      logger.error("OAuth callback failed", {
        details: error instanceof Error ? error.message : String(error)
      });
      return c.redirect(
        `${env.WEB_ORIGIN}/?auth_error=oauth_callback_failed`,
        302
      );
    }
  })
  .post("/logout", (c) => {
    const user = c.get("currentUser");
    const sessionId = c.get("sessionId");
    deleteNextcloudConnection(user.id);
    clearCardsForUser(user.id);
    deleteSession(sessionId);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  })
  .put("/profile", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          ok: false,
          error: "invalid_profile_payload",
          issues: parsed.error.issues
        },
        400
      );
    }

    const currentUser = c.get("currentUser");
    const connection = getNextcloudConnectionStatus(currentUser.id);
    if (!connection.connected) {
      return c.json({ ok: false, error: "not_authenticated" }, 401);
    }

    const nextProfile = {
      displayName: parsed.data.displayName,
      email:
        typeof parsed.data.email === "string" && parsed.data.email.trim().length > 0
          ? parsed.data.email.trim()
          : null
    };
    const creds = await getNextcloudCredentials(currentUser.id);
    if (!creds) {
      return c.json({ ok: false, error: "nextcloud_credentials_unavailable" }, 502);
    }

    const client = new NextcloudClient(creds.baseUrl, creds.username, creds.auth);

    try {
      const existingSettings = await readNextcloudSettings(
        client,
        creds.remoteFolder
      );
      const status = getNextcloudConnectionStatus(currentUser.id);
      await writeNextcloudSettings(client, {
        profile: nextProfile,
        connection: {
          baseUrl: creds.baseUrl,
          username: creds.username,
          remoteFolder: creds.remoteFolder,
          lastSyncAt: existingSettings?.connection.lastSyncAt ?? status.lastSyncAt
        }
      });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: "nextcloud_profile_persist_failed",
          details: error instanceof Error ? error.message : String(error)
        },
        502
      );
    }

    const nextUser = updateCurrentUser(currentUser.id, {
      displayName: nextProfile.displayName,
      email: nextProfile.email
    });

    c.set("currentUser", nextUser);
    return c.json({ ok: true, user: nextUser });
  });
