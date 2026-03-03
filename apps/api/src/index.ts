import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import type { AppEnv } from "./lib/app-env";
import { sessionMiddleware } from "./middleware/session";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";
import { nextcloudRoutes } from "./routes/nextcloud";
import { cardsRoutes } from "./routes/cards";
import "./db/client";

const app = new Hono<AppEnv>();

app.use(
  "/api/*",
  cors({
    origin: env.WEB_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true
  })
);

app.use("/api/*", sessionMiddleware);

app.get("/", (c) =>
  c.json({
    name: "characters-api",
    ok: true,
    docs: "/api/health"
  })
);

app.route("/api", healthRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/nextcloud", nextcloudRoutes);
app.route("/api/cards", cardsRoutes);

app.onError((error, c) => {
  logger.error("Unhandled API error", {
    path: c.req.path,
    method: c.req.method,
    error: error instanceof Error ? error.message : String(error)
  });

  return c.json(
    {
      ok: false,
      error: "internal_error"
    },
    500
  );
});

app.notFound((c) => c.json({ ok: false, error: "not_found" }, 404));

const server = serve(
  {
    fetch: app.fetch,
    hostname: env.API_HOST,
    port: env.API_PORT
  },
  (info) => {
    logger.info("API started", {
      host: info.address,
      port: info.port
    });
  }
);

const shutdown = (signal: string): void => {
  logger.info("Shutting down API", { signal });
  server.close();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
