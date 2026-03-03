import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { decryptSecret, encryptSecret } from "./secrets";
import { normalizeBaseUrl, normalizeRemoteFolder } from "./nextcloud-client";
import { refreshNextcloudToken } from "./nextcloud-oauth";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const OAUTH_STATE_TTL_MS = 1000 * 60 * 10;

export type AppUser = {
  id: string;
  email: string | null;
  displayName: string;
};

export type NextcloudConnectionStatus = {
  connected: boolean;
  baseUrl: string | null;
  username: string | null;
  remoteFolder: string | null;
  lastSyncAt: string | null;
};

export type NextcloudConnectionCredentials = {
  baseUrl: string;
  username: string;
  nextcloudUserId: string;
  remoteFolder: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAtMs: number;
  scope: string | null;
};

type UserRow = {
  id: string;
  email: string | null;
  display_name: string;
};

type NextcloudConnectionRow = {
  user_id: string;
  base_url: string;
  username: string;
  nextcloud_user_id: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  token_expires_at: number;
  scope: string | null;
  remote_folder: string;
  last_sync_at: number | null;
};

function toAppUser(row: UserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name
  };
}

function deleteExpiredSessions(db: Database.Database): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}

function getUserById(db: Database.Database, userId: string): AppUser | null {
  const row = db
    .prepare(
      `
        SELECT id, email, display_name
        FROM users
        WHERE id = ?
        LIMIT 1
      `
    )
    .get(userId) as UserRow | undefined;
  return row ? toAppUser(row) : null;
}

function createAnonymousUser(db: Database.Database): AppUser {
  const now = Date.now();
  const id = randomUUID();
  const displayName = `Guest-${id.slice(0, 8)}`;
  db.prepare(
    `
      INSERT INTO users (id, email, display_name, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?)
    `
  ).run(id, displayName, now, now);

  return { id, email: null, displayName };
}

function createSession(db: Database.Database, userId: string): string {
  const now = Date.now();
  const sessionId = randomUUID();
  db.prepare(
    `
      INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(sessionId, userId, now, now, now + SESSION_TTL_MS);
  return sessionId;
}

function touchSession(db: Database.Database, sessionId: string): void {
  const now = Date.now();
  db.prepare(
    `
      UPDATE sessions
      SET last_seen_at = ?, expires_at = ?
      WHERE id = ?
    `
  ).run(now, now + SESSION_TTL_MS, sessionId);
}

export function getOrCreateSessionForRequest(
  db: Database.Database,
  existingSessionId: string | null
): { sessionId: string; user: AppUser } {
  deleteExpiredSessions(db);

  if (existingSessionId) {
    const row = db
      .prepare(
        `
          SELECT id, user_id, expires_at
          FROM sessions
          WHERE id = ?
            AND expires_at > ?
          LIMIT 1
        `
      )
      .get(existingSessionId, Date.now()) as
      | { id: string; user_id: string; expires_at: number }
      | undefined;

    if (row) {
      const user = getUserById(db, row.user_id);
      if (user) {
        touchSession(db, row.id);
        return { sessionId: row.id, user };
      }
    }
  }

  const user = createAnonymousUser(db);
  const sessionId = createSession(db, user.id);
  return { sessionId, user };
}

export function setSessionUser(
  db: Database.Database,
  sessionId: string,
  userId: string
): void {
  const now = Date.now();
  db.prepare(
    `
      UPDATE sessions
      SET user_id = ?, last_seen_at = ?, expires_at = ?
      WHERE id = ?
    `
  ).run(userId, now, now + SESSION_TTL_MS, sessionId);
}

export function deleteSession(db: Database.Database, sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function updateUserProfile(
  db: Database.Database,
  userId: string,
  input: { displayName: string; email: string | null }
): AppUser {
  const now = Date.now();
  db.prepare(
    `
      UPDATE users
      SET email = ?, display_name = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(input.email, input.displayName, now, userId);

  const user = getUserById(db, userId);
  if (!user) throw new Error("User not found after update");
  return user;
}

export function createOauthState(
  db: Database.Database,
  sessionId: string,
  returnTo: string | null = null
): string {
  db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(Date.now());
  const now = Date.now();
  const state = randomUUID();
  db.prepare(
    `
      INSERT INTO oauth_states (state, session_id, return_to, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(state, sessionId, returnTo, now, now + OAUTH_STATE_TTL_MS);
  return state;
}

export function consumeOauthState(
  db: Database.Database,
  state: string
): { sessionId: string; returnTo: string | null } | null {
  db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(Date.now());
  const row = db
    .prepare(
      `
        SELECT state, session_id, return_to
        FROM oauth_states
        WHERE state = ?
          AND expires_at > ?
        LIMIT 1
      `
    )
    .get(state, Date.now()) as
    | { state: string; session_id: string; return_to: string | null }
    | undefined;
  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  if (!row) return null;
  return {
    sessionId: row.session_id,
    returnTo: row.return_to ?? null,
  };
}

export function findUserIdByNextcloudIdentity(
  db: Database.Database,
  baseUrl: string,
  nextcloudUserId: string
): string | null {
  const row = db
    .prepare(
      `
        SELECT user_id
        FROM nextcloud_connections
        WHERE base_url = ?
          AND nextcloud_user_id = ?
        LIMIT 1
      `
    )
    .get(normalizeBaseUrl(baseUrl), nextcloudUserId.trim()) as
    | { user_id: string }
    | undefined;
  return row?.user_id ?? null;
}

export function upsertNextcloudOAuthConnection(
  db: Database.Database,
  input: {
    userId: string;
    baseUrl: string;
    username: string;
    nextcloudUserId: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAtMs: number;
    scope: string | null;
    remoteFolder: string;
    lastSyncAt?: string | null;
  }
): void {
  const now = Date.now();
  const parsedLastSyncAt = (() => {
    if (!input.lastSyncAt) return null;
    const value = Date.parse(input.lastSyncAt);
    return Number.isFinite(value) ? value : null;
  })();

  db.prepare(
    `
      INSERT INTO nextcloud_connections (
        user_id,
        base_url,
        username,
        nextcloud_user_id,
        access_token_enc,
        refresh_token_enc,
        token_expires_at,
        scope,
        remote_folder,
        last_sync_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        base_url = excluded.base_url,
        username = excluded.username,
        nextcloud_user_id = excluded.nextcloud_user_id,
        access_token_enc = excluded.access_token_enc,
        refresh_token_enc = excluded.refresh_token_enc,
        token_expires_at = excluded.token_expires_at,
        scope = excluded.scope,
        remote_folder = excluded.remote_folder,
        last_sync_at = excluded.last_sync_at,
        updated_at = excluded.updated_at
    `
  ).run(
    input.userId,
    normalizeBaseUrl(input.baseUrl),
    input.username.trim(),
    input.nextcloudUserId.trim(),
    encryptSecret(input.accessToken),
    input.refreshToken ? encryptSecret(input.refreshToken) : null,
    input.tokenExpiresAtMs,
    input.scope,
    normalizeRemoteFolder(input.remoteFolder),
    parsedLastSyncAt,
    now,
    now
  );
}

export function getNextcloudConnectionStatus(
  db: Database.Database,
  userId: string
): NextcloudConnectionStatus {
  const row = db
    .prepare(
      `
        SELECT base_url, username, remote_folder, last_sync_at
        FROM nextcloud_connections
        WHERE user_id = ?
        LIMIT 1
      `
    )
    .get(userId) as
    | { base_url: string; username: string; remote_folder: string; last_sync_at: number | null }
    | undefined;

  if (!row) {
    return {
      connected: false,
      baseUrl: null,
      username: null,
      remoteFolder: null,
      lastSyncAt: null
    };
  }

  return {
    connected: true,
    baseUrl: row.base_url,
    username: row.username,
    remoteFolder: row.remote_folder,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null
  };
}

function getConnectionRow(
  db: Database.Database,
  userId: string
): NextcloudConnectionRow | null {
  const row = db
    .prepare(
      `
        SELECT
          user_id,
          base_url,
          username,
          nextcloud_user_id,
          access_token_enc,
          refresh_token_enc,
          token_expires_at,
          scope,
          remote_folder,
          last_sync_at
        FROM nextcloud_connections
        WHERE user_id = ?
        LIMIT 1
      `
    )
    .get(userId) as NextcloudConnectionRow | undefined;
  return row ?? null;
}

function updateOAuthTokens(
  db: Database.Database,
  input: {
    userId: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAtMs: number;
    scope: string | null;
  }
): void {
  db.prepare(
    `
      UPDATE nextcloud_connections
      SET
        access_token_enc = ?,
        refresh_token_enc = ?,
        token_expires_at = ?,
        scope = ?,
        updated_at = ?
      WHERE user_id = ?
    `
  ).run(
    encryptSecret(input.accessToken),
    input.refreshToken ? encryptSecret(input.refreshToken) : null,
    input.tokenExpiresAtMs,
    input.scope,
    Date.now(),
    input.userId
  );
}

export async function getNextcloudCredentials(
  db: Database.Database,
  userId: string
): Promise<NextcloudConnectionCredentials | null> {
  const row = getConnectionRow(db, userId);
  if (!row) return null;

  let accessToken = decryptSecret(row.access_token_enc);
  let refreshToken = row.refresh_token_enc ? decryptSecret(row.refresh_token_enc) : null;
  let tokenExpiresAtMs = row.token_expires_at;
  let scope = row.scope ?? null;

  if (tokenExpiresAtMs <= Date.now() + 60_000 && refreshToken) {
    const refreshed = await refreshNextcloudToken(refreshToken);
    accessToken = refreshed.accessToken;
    refreshToken = refreshed.refreshToken ?? refreshToken;
    tokenExpiresAtMs = refreshed.tokenExpiresAtMs;
    scope = refreshed.scope;
    updateOAuthTokens(db, {
      userId,
      accessToken,
      refreshToken,
      tokenExpiresAtMs,
      scope
    });
  }

  return {
    baseUrl: row.base_url,
    username: row.username,
    nextcloudUserId: row.nextcloud_user_id,
    remoteFolder: row.remote_folder,
    accessToken,
    refreshToken,
    tokenExpiresAtMs,
    scope
  };
}

export function updateNextcloudRemoteFolder(
  db: Database.Database,
  userId: string,
  remoteFolder: string
): void {
  db.prepare(
    `
      UPDATE nextcloud_connections
      SET remote_folder = ?, updated_at = ?
      WHERE user_id = ?
    `
  ).run(normalizeRemoteFolder(remoteFolder), Date.now(), userId);
}

export function updateNextcloudLastSync(
  db: Database.Database,
  userId: string,
  syncedAtMs: number
): void {
  db.prepare(
    `
      UPDATE nextcloud_connections
      SET last_sync_at = ?, updated_at = ?
      WHERE user_id = ?
    `
  ).run(syncedAtMs, Date.now(), userId);
}

export function deleteNextcloudConnection(
  db: Database.Database,
  userId: string
): void {
  db.prepare("DELETE FROM nextcloud_connections WHERE user_id = ?").run(userId);
}
