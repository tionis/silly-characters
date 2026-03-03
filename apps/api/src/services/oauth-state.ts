import { randomUUID } from "node:crypto";
import { db } from "../db/client";
import type { OauthStateRow } from "../types";

const OAUTH_STATE_TTL_MS = 1000 * 60 * 10;

function deleteExpiredStates(): void {
  db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").run(Date.now());
}

export function createOauthState(sessionId: string): string {
  deleteExpiredStates();
  const now = Date.now();
  const state = randomUUID();

  db.prepare(
    `
      INSERT INTO oauth_states (state, session_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `
  ).run(state, sessionId, now, now + OAUTH_STATE_TTL_MS);

  return state;
}

export function consumeOauthState(state: string): string | null {
  deleteExpiredStates();
  const row = db
    .prepare(
      `
        SELECT state, session_id, created_at, expires_at
        FROM oauth_states
        WHERE state = ?
          AND expires_at > ?
        LIMIT 1
      `
    )
    .get(state, Date.now()) as OauthStateRow | undefined;

  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);

  return row?.session_id ?? null;
}
