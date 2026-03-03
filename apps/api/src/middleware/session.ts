import { getCookie, setCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../lib/app-env";
import { getOrCreateSessionForRequest } from "../services/auth";

export const SESSION_COOKIE = "characters_sid";
export const SESSION_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30;

export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const existingSessionId = getCookie(c, SESSION_COOKIE) ?? null;
  const { user, sessionId } = getOrCreateSessionForRequest(existingSessionId);

  c.set("currentUser", user);
  c.set("sessionId", sessionId);

  setCookie(c, SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SEC
  });

  await next();
};
