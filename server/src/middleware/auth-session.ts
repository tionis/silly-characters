import type { NextFunction, Request, Response } from "express";
import type Database from "better-sqlite3";
import {
  getNextcloudConnectionStatus,
  getOrCreateSessionForRequest
} from "../services/auth-store";

export const SESSION_COOKIE = "characters_sid";
const SESSION_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function getDb(req: Request): Database.Database {
  const db = req.app.locals.db as Database.Database | undefined;
  if (!db) {
    throw new Error("Database is not initialized");
  }
  return db;
}

export function sessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const db = getDb(req);
    const existingSessionId =
      typeof req.cookies?.[SESSION_COOKIE] === "string"
        ? (req.cookies[SESSION_COOKIE] as string)
        : null;

    const { sessionId, user } = getOrCreateSessionForRequest(db, existingSessionId);
    req.sessionId = sessionId;
    req.currentUser = user;

    res.cookie(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: SESSION_COOKIE_MAX_AGE_MS,
      path: "/"
    });

    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuthenticatedUser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const db = getDb(req);
    const userId = req.currentUser?.id;
    if (!userId) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const status = getNextcloudConnectionStatus(db, userId);
    if (!status.connected) {
      res.status(401).json({ ok: false, error: "not_authenticated" });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}
