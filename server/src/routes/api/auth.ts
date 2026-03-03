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
import { syncUserNextcloudIndex } from "../../services/nextcloud-index";
import {
  getNextcloudLibraryFolderKey,
  getOrCreateNextcloudLibraryId,
} from "../../services/nextcloud-storage";
import {
  getSettingsForUser,
  updateSettingsForUser,
} from "../../services/settings";
import { logger } from "../../utils/logger";
import { SESSION_COOKIE } from "../../middleware/auth-session";
import type { SseHub } from "../../services/sse-hub";

const router = Router();

function getDb(req: Request): Database.Database {
  return req.app.locals.db as Database.Database;
}

function getHub(req: Request): SseHub | null {
  const hub = (req.app.locals as any).sseHub as SseHub | undefined;
  return hub ?? null;
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

async function syncUserLibraryIndex(req: Request, userId: string): Promise<void> {
  const db = getDb(req);
  const startedAt = Date.now();
  const syncResult = await syncUserNextcloudIndex({ db, userId });
  const finishedAt = Date.now();

  const status = getNextcloudConnectionStatus(db, userId);
  const folderPath = status.remoteFolder ?? "/characters";
  const libraryFolderKey = getNextcloudLibraryFolderKey(userId, folderPath);
  const libraryId = getOrCreateNextcloudLibraryId(db, userId, folderPath);

  const currentSettings = await getSettingsForUser(userId, db);
  await updateSettingsForUser(
    {
      ...currentSettings,
      cardsFolderPath: libraryFolderKey,
      sillytavenrPath: null,
    },
    userId,
    { skipPathValidation: true },
    db
  );

  const locals = req.app.locals as any;
  const revision = Number.isFinite(locals.nextcloudRevision)
    ? Number(locals.nextcloudRevision) + 1
    : 1;
  locals.nextcloudRevision = revision;

  getHub(req)?.broadcast(
    "cards:resynced",
    {
      revision,
      origin: "app",
      libraryId,
      folderPath,
      addedCards: syncResult.indexed,
      removedCards: syncResult.removed,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt
    },
    { id: `${revision}:resynced` }
  );

  logger.info("Nextcloud index synced for user", {
    userId,
    indexed: syncResult.indexed,
    skipped: syncResult.skipped,
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
    await syncUserLibraryIndex(req, userId);

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
    await syncUserLibraryIndex(req, user.id);
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
