import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import {
  consumeOauthState,
  createOauthState,
  deleteSession,
  findUserIdByNextcloudIdentity,
  getNextcloudConnectionStatus,
  getNextcloudCredentials,
  setSessionUser,
  upsertNextcloudOAuthConnection,
  updateNextcloudLastSync,
  updateNextcloudRemoteFolder,
  updateUserProfile
} from "../../services/auth-store";
import {
  buildNextcloudAuthorizeUrl,
  exchangeCodeForToken,
  fetchNextcloudOAuthUser,
  getOAuthBaseUrl
} from "../../services/nextcloud-oauth";
import { NextcloudClient } from "../../services/nextcloud-client";
import {
  readNextcloudSettings,
  writeNextcloudSettings
} from "../../services/nextcloud-settings";
import {
  getUserCardsMirrorPath,
  syncNextcloudPngsToLocalMirror
} from "../../services/nextcloud-sync";
import { getOrCreateLibraryId } from "../../services/libraries";
import type { CardsSyncOrchestrator } from "../../services/cards-sync-orchestrator";
import {
  getSettingsForUser,
  updateSettingsForUser
} from "../../services/settings";
import { logger } from "../../utils/logger";
import { SESSION_COOKIE } from "../../middleware/auth-session";

const router = Router();

function getDb(req: Request): Database.Database {
  return req.app.locals.db as Database.Database;
}

function getOrchestrator(req: Request): CardsSyncOrchestrator {
  const orchestrator = (req.app.locals as any)
    .cardsSyncOrchestrator as CardsSyncOrchestrator | undefined;
  if (!orchestrator) {
    throw new Error("CardsSyncOrchestrator is not initialized");
  }
  return orchestrator;
}

function webOrigin(): string {
  const configured = String(process.env.WEB_ORIGIN ?? "").trim();
  if (configured) return configured;
  return "http://127.0.0.1:5173";
}

function sanitizeReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function resolveReturnTo(req: Request): string | null {
  const fromQuery = sanitizeReturnTo(req.query.return_to);
  if (fromQuery) return fromQuery;

  const fromReferer = sanitizeReturnTo(req.get("referer"));
  if (fromReferer) return fromReferer;

  const fromOrigin = sanitizeReturnTo(req.get("origin"));
  if (fromOrigin) return fromOrigin;

  return null;
}

async function syncUserMirrorAndScan(req: Request, userId: string): Promise<void> {
  const db = getDb(req);
  const creds = await getNextcloudCredentials(db, userId);
  if (!creds) {
    throw new Error("Nextcloud credentials unavailable");
  }

  const client = new NextcloudClient(
    creds.baseUrl,
    creds.username,
    creds.accessToken
  );
  const syncResult = await syncNextcloudPngsToLocalMirror({
    userId,
    client,
    remoteFolder: creds.remoteFolder
  });

  updateNextcloudLastSync(db, userId, Date.now());

  const localCardsPath = getUserCardsMirrorPath(userId);
  const currentSettings = await getSettingsForUser(userId);
  await updateSettingsForUser(
    {
      ...currentSettings,
      cardsFolderPath: localCardsPath,
      sillytavenrPath: null
    },
    userId,
    { skipPathValidation: true }
  );

  const libraryId = getOrCreateLibraryId(db, localCardsPath);
  getOrchestrator(req).requestScan("app", localCardsPath, libraryId);

  logger.info("Nextcloud mirror synced for user", {
    userId,
    downloaded: syncResult.downloaded,
    removed: syncResult.removed,
    totalRemotePng: syncResult.totalRemotePng
  });
}

router.get("/auth/me", (req: Request, res: Response) => {
  const db = getDb(req);
  const user = req.currentUser ?? null;
  if (!user) {
    res.json({
      authenticated: false,
      user: null,
      nextcloud: getNextcloudConnectionStatus(db, ""),
      loginPath: "/api/auth/login"
    });
    return;
  }

  const connection = getNextcloudConnectionStatus(db, user.id);
  const authenticated = connection.connected;
  res.json({
    authenticated,
    user: authenticated ? user : null,
    nextcloud: connection,
    loginPath: "/api/auth/login"
  });
});

router.get("/auth/login-url", (req: Request, res: Response) => {
  const db = getDb(req);
  const sessionId = req.sessionId;
  if (!sessionId) {
    res.status(500).json({ ok: false, error: "session_unavailable" });
    return;
  }

  try {
    const state = createOauthState(db, sessionId, resolveReturnTo(req));
    res.json({
      ok: true,
      url: buildNextcloudAuthorizeUrl(state)
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "oauth_not_configured",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

router.get("/auth/login", (req: Request, res: Response) => {
  const db = getDb(req);
  const sessionId = req.sessionId;
  if (!sessionId) {
    res.status(500).json({ ok: false, error: "session_unavailable" });
    return;
  }

  try {
    const state = createOauthState(db, sessionId, resolveReturnTo(req));
    res.redirect(buildNextcloudAuthorizeUrl(state));
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "oauth_not_configured",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

router.get("/auth/callback", async (req: Request, res: Response) => {
  const db = getDb(req);
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  const oauthError = typeof req.query.error === "string" ? req.query.error : null;
  const fallbackOrigin = webOrigin();

  if (oauthError) {
    res.redirect(`${fallbackOrigin}/?auth_error=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code || !state) {
    res.redirect(`${fallbackOrigin}/?auth_error=missing_code_or_state`);
    return;
  }

  const currentSessionId = req.sessionId ?? null;
  const consumedState = consumeOauthState(db, state);
  const sessionIdFromState = consumedState?.sessionId ?? null;
  const callbackOrigin =
    sanitizeReturnTo(consumedState?.returnTo ?? null) ?? fallbackOrigin;
  if (!currentSessionId || !sessionIdFromState || sessionIdFromState !== currentSessionId) {
    res.redirect(`${callbackOrigin}/?auth_error=invalid_or_expired_state`);
    return;
  }

  try {
    const token = await exchangeCodeForToken(code);
    const oauthUser = await fetchNextcloudOAuthUser(token.accessToken);
    const baseUrl = getOAuthBaseUrl();

    const currentUser = req.currentUser;
    if (!currentUser) {
      res.redirect(`${callbackOrigin}/?auth_error=session_user_missing`);
      return;
    }

    const existingUserId = findUserIdByNextcloudIdentity(
      db,
      baseUrl,
      oauthUser.nextcloudUserId
    );
    const userId = existingUserId ?? currentUser.id;

    if (existingUserId && existingUserId !== currentUser.id) {
      setSessionUser(db, currentSessionId, existingUserId);
    }

    let resolvedUser = updateUserProfile(db, userId, {
      displayName: oauthUser.displayName,
      email: oauthUser.email
    });

    const previousStatus = getNextcloudConnectionStatus(db, userId);
    const remoteFolder = previousStatus.remoteFolder ?? "/characters";

    upsertNextcloudOAuthConnection(db, {
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

    try {
      const creds = await getNextcloudCredentials(db, userId);
      if (creds) {
        const client = new NextcloudClient(
          creds.baseUrl,
          creds.username,
          creds.accessToken
        );
        const settings = await readNextcloudSettings(client, creds.remoteFolder);
        if (settings) {
          resolvedUser = updateUserProfile(db, userId, settings.profile);
          updateNextcloudRemoteFolder(db, userId, settings.connection.remoteFolder);
          if (settings.connection.lastSyncAt) {
            const ms = Date.parse(settings.connection.lastSyncAt);
            if (Number.isFinite(ms)) {
              updateNextcloudLastSync(db, userId, ms);
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

    req.currentUser = resolvedUser;
    await syncUserMirrorAndScan(req, userId);

    res.redirect(`${callbackOrigin}/?auth=success`);
  } catch (error) {
    logger.error(error, "OAuth callback failed");
    res.redirect(`${callbackOrigin}/?auth_error=oauth_callback_failed`);
  }
});

router.post("/auth/logout", (req: Request, res: Response) => {
  const db = getDb(req);
  const sessionId = req.sessionId;
  if (sessionId) {
    deleteSession(db, sessionId);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

router.post("/auth/sync", async (req: Request, res: Response) => {
  const user = req.currentUser;
  if (!user) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const db = getDb(req);
  const status = getNextcloudConnectionStatus(db, user.id);
  if (!status.connected) {
    res.status(401).json({ ok: false, error: "not_authenticated" });
    return;
  }

  try {
    await syncUserMirrorAndScan(req, user.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: "sync_failed",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
