import { db } from "../db/client";
import { decryptSecret, encryptSecret } from "../lib/secrets";
import type { NextcloudConnectionRow } from "../types";
import { normalizeBaseUrl, normalizeRemoteFolder } from "./nextcloud-client";
import { refreshNextcloudToken } from "./nextcloud-oauth";

export type NextcloudConnectionPublic = {
  connected: boolean;
  authType: "oauth" | "app_password" | null;
  baseUrl: string | null;
  username: string | null;
  remoteFolder: string | null;
  lastSyncAt: string | null;
};

type NextcloudCredentialsAuth =
  | { type: "basic"; appPassword: string }
  | { type: "bearer"; accessToken: string };

export type NextcloudCredentials = {
  authType: "oauth" | "app_password";
  baseUrl: string;
  username: string;
  remoteFolder: string;
  auth: NextcloudCredentialsAuth;
};

function getConnectionRow(userId: string): NextcloudConnectionRow | null {
  const row = db
    .prepare(
      `
        SELECT
          user_id,
          base_url,
          username,
          app_password_enc,
          auth_type,
          access_token_enc,
          refresh_token_enc,
          token_expires_at,
          nextcloud_user_id,
          scope,
          remote_folder,
          last_sync_at,
          created_at,
          updated_at
        FROM nextcloud_connections
        WHERE user_id = ?
        LIMIT 1
      `
    )
    .get(userId) as NextcloudConnectionRow | undefined;

  return row ?? null;
}

export function findUserIdByNextcloudIdentity(
  baseUrl: string,
  nextcloudUserId: string
): string | null {
  const row = db
    .prepare(
      `
        SELECT user_id
        FROM nextcloud_connections
        WHERE nextcloud_user_id = ?
          AND base_url = ?
        LIMIT 1
      `
    )
    .get(nextcloudUserId, normalizeBaseUrl(baseUrl)) as
    | { user_id: string }
    | undefined;

  return row?.user_id ?? null;
}

export function getNextcloudConnectionStatus(userId: string): NextcloudConnectionPublic {
  const row = getConnectionRow(userId);
  if (!row) {
    return {
      connected: false,
      authType: null,
      baseUrl: null,
      username: null,
      remoteFolder: null,
      lastSyncAt: null
    };
  }

  return {
    connected: true,
    authType: row.auth_type,
    baseUrl: row.base_url,
    username: row.username,
    remoteFolder: row.remote_folder,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).toISOString() : null
  };
}

type OAuthUpsertInput = {
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
};

export function upsertNextcloudOAuthConnection(input: OAuthUpsertInput): void {
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
        auth_type,
        app_password_enc,
        access_token_enc,
        refresh_token_enc,
        token_expires_at,
        nextcloud_user_id,
        scope,
        remote_folder,
        last_sync_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 'oauth', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        base_url = excluded.base_url,
        username = excluded.username,
        auth_type = excluded.auth_type,
        app_password_enc = excluded.app_password_enc,
        access_token_enc = excluded.access_token_enc,
        refresh_token_enc = excluded.refresh_token_enc,
        token_expires_at = excluded.token_expires_at,
        nextcloud_user_id = excluded.nextcloud_user_id,
        scope = excluded.scope,
        remote_folder = excluded.remote_folder,
        last_sync_at = excluded.last_sync_at,
        updated_at = excluded.updated_at
    `
  ).run(
    input.userId,
    normalizeBaseUrl(input.baseUrl),
    input.username.trim(),
    encryptSecret(input.accessToken),
    input.refreshToken ? encryptSecret(input.refreshToken) : null,
    input.tokenExpiresAtMs,
    input.nextcloudUserId.trim(),
    input.scope,
    normalizeRemoteFolder(input.remoteFolder),
    parsedLastSyncAt,
    now,
    now
  );
}

function updateOAuthTokens(input: {
  userId: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAtMs: number;
  scope: string | null;
}): void {
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
  userId: string
): Promise<NextcloudCredentials | null> {
  const row = getConnectionRow(userId);
  if (!row) return null;

  if (row.auth_type === "oauth") {
    if (!row.access_token_enc) return null;
    let accessToken = decryptSecret(row.access_token_enc);
    let refreshToken = row.refresh_token_enc
      ? decryptSecret(row.refresh_token_enc)
      : null;
    let tokenExpiresAtMs = row.token_expires_at ?? 0;
    let scope = row.scope ?? null;

    const now = Date.now();
    const mustRefresh = tokenExpiresAtMs > 0 && tokenExpiresAtMs <= now + 60_000;

    if (mustRefresh && refreshToken) {
      const refreshed = await refreshNextcloudToken(refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken ?? refreshToken;
      tokenExpiresAtMs = refreshed.tokenExpiresAtMs;
      scope = refreshed.scope;
      updateOAuthTokens({
        userId,
        accessToken,
        refreshToken,
        tokenExpiresAtMs,
        scope
      });
    }

    return {
      authType: "oauth",
      baseUrl: row.base_url,
      username: row.username,
      remoteFolder: row.remote_folder,
      auth: {
        type: "bearer",
        accessToken
      }
    };
  }

  return {
    authType: "app_password",
    baseUrl: row.base_url,
    username: row.username,
    remoteFolder: row.remote_folder,
    auth: {
      type: "basic",
      appPassword: decryptSecret(row.app_password_enc)
    }
  };
}

export function updateNextcloudRemoteFolder(userId: string, remoteFolder: string): void {
  db.prepare(
    `
      UPDATE nextcloud_connections
      SET remote_folder = ?, updated_at = ?
      WHERE user_id = ?
    `
  ).run(normalizeRemoteFolder(remoteFolder), Date.now(), userId);
}

export function deleteNextcloudConnection(userId: string): void {
  db.prepare("DELETE FROM nextcloud_connections WHERE user_id = ?").run(userId);
}

export function updateNextcloudLastSync(userId: string, syncedAtMs: number): void {
  db.prepare(
    `
      UPDATE nextcloud_connections
      SET last_sync_at = ?, updated_at = ?
      WHERE user_id = ?
    `
  ).run(syncedAtMs, Date.now(), userId);
}
