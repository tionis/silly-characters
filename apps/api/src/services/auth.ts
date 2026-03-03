import { randomUUID } from "node:crypto";
import { db } from "../db/client";
import type { AppUser, SessionRecord } from "../types";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

type UserRow = {
  id: string;
  email: string | null;
  display_name: string;
};

function toAppUser(row: UserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name
  };
}

function createAnonymousUser(): AppUser {
  const now = Date.now();
  const id = randomUUID();
  const displayName = `Guest-${id.slice(0, 8)}`;
  db.prepare(
    `
      INSERT INTO users (id, email, display_name, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?)
    `
  ).run(id, displayName, now, now);

  return {
    id,
    email: null,
    displayName
  };
}

export function getUserById(userId: string): AppUser | null {
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

function createSession(userId: string): SessionRecord {
  const now = Date.now();
  const sessionId = randomUUID();
  const expiresAt = now + SESSION_TTL_MS;

  db.prepare(
    `
      INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `
  ).run(sessionId, userId, now, now, expiresAt);

  return {
    id: sessionId,
    userId,
    expiresAt
  };
}

function getSession(sessionId: string): SessionRecord | null {
  const now = Date.now();
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
    .get(sessionId, now) as
    | { id: string; user_id: string; expires_at: number }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at
  };
}

export function setSessionUser(sessionId: string, userId: string): void {
  db.prepare(
    `
      UPDATE sessions
      SET user_id = ?, last_seen_at = ?, expires_at = ?
      WHERE id = ?
    `
  ).run(userId, Date.now(), Date.now() + SESSION_TTL_MS, sessionId);
}

export function deleteSession(sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

function touchSession(sessionId: string): void {
  const now = Date.now();
  const nextExpiry = now + SESSION_TTL_MS;
  db.prepare(
    `
      UPDATE sessions
      SET last_seen_at = ?, expires_at = ?
      WHERE id = ?
    `
  ).run(now, nextExpiry, sessionId);
}

function deleteExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}

export function getOrCreateSessionForRequest(existingSessionId: string | null): {
  user: AppUser;
  sessionId: string;
  isNewSession: boolean;
} {
  deleteExpiredSessions();

  if (existingSessionId) {
    const existingSession = getSession(existingSessionId);
    if (existingSession) {
      const user = getUserById(existingSession.userId);
      if (user) {
        touchSession(existingSession.id);
        return {
          user,
          sessionId: existingSession.id,
          isNewSession: false
        };
      }
    }
  }

  const user = createAnonymousUser();
  const session = createSession(user.id);

  return {
    user,
    sessionId: session.id,
    isNewSession: true
  };
}

export function updateCurrentUser(
  userId: string,
  input: { email: string | null; displayName: string }
): AppUser {
  const now = Date.now();
  db.prepare(
    `
      UPDATE users
      SET email = ?, display_name = ?, updated_at = ?
      WHERE id = ?
    `
  ).run(input.email, input.displayName, now, userId);

  const user = getUserById(userId);
  if (!user) {
    throw new Error("User not found after update");
  }
  return user;
}
