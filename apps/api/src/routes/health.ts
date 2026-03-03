import { Hono } from "hono";

export const healthRoutes = new Hono().get("/health", (c) =>
  c.json({
    ok: true,
    service: "characters-api",
    now: new Date().toISOString()
  })
);
