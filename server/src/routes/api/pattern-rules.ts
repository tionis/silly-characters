import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { SseHub } from "../../services/sse-hub";
import { getPatternRules, updatePatternRules } from "../../services/pattern-rules";
import { AppError } from "../../errors/app-error";
import { sendError } from "../../errors/http";
import { logger } from "../../utils/logger";
import { startPatternRulesRun } from "../../services/pattern-rules-runner";

const router = Router();

function getDb(req: Request): Database.Database {
  return req.app.locals.db as Database.Database;
}

function getHub(req: Request): SseHub {
  const hub = (req.app.locals as any).sseHub as SseHub | undefined;
  if (!hub) throw new Error("SSE hub is not initialized");
  return hub;
}

type PatternRunState = { runningUsers: Set<string> };

function getState(req: Request): PatternRunState {
  const locals = req.app.locals as any;
  if (!locals.patternRulesState) {
    locals.patternRulesState = { runningUsers: new Set<string>() };
  }
  return locals.patternRulesState as PatternRunState;
}

function getUserId(req: Request): string | null {
  const value = req.currentUser?.id;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

router.get("/pattern-rules", async (req: Request, res: Response) => {
  try {
    const db = getDb(req);
    const file = await getPatternRules(db, getUserId(req));
    res.json(file);
  } catch (error) {
    logger.errorKey(error, "api.pattern_rules.get_failed");
    return sendError(res, error, {
      status: 500,
      code: "api.pattern_rules.get_failed",
    });
  }
});

router.put("/pattern-rules", async (req: Request, res: Response) => {
  try {
    const db = getDb(req);
    const body = req.body as any;
    const rulesInput = Array.isArray(body) ? body : body?.rules;
    const next = await updatePatternRules(db, getUserId(req), rulesInput);
    res.json(next);
  } catch (error) {
    logger.errorKey(error, "api.pattern_rules.update_failed");
    return sendError(res, error, {
      status: 500,
      code: "api.pattern_rules.update_failed",
    });
  }
});

router.get("/pattern-rules/status", async (req: Request, res: Response) => {
  try {
    const db = getDb(req);
    const userId = getUserId(req);
    if (!userId) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const file = await getPatternRules(db, userId);
    const hasRules = file.rules.length > 0;
    const hasEnabledRules = file.rules.some((r) => r.enabled);

    const rows = db
      .prepare(
        `
        SELECT rules_hash, created_at, status, error
        FROM user_pattern_rules_cache
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 20
      `
      )
      .all(userId) as Array<{
      rules_hash: string;
      created_at: number;
      status: "building" | "ready" | "failed";
      error: string | null;
    }>;

    const lastReady = rows.find((r) => r.status === "ready") ?? null;
    const latest = rows.length > 0 ? rows[0] : null;
    const current =
      latest && (latest.status === "building" || latest.status === "failed")
        ? latest
        : null;

    res.json({
      hasRules,
      hasEnabledRules,
      lastReady: lastReady
        ? { rules_hash: lastReady.rules_hash, created_at: lastReady.created_at }
        : null,
      current: current
        ? {
            rules_hash: current.rules_hash,
            created_at: current.created_at,
            status: current.status,
            error: current.error,
          }
        : null,
    });
  } catch (error) {
    logger.errorKey(error, "api.pattern_rules.status_failed");
    return sendError(res, error, {
      status: 500,
      code: "api.pattern_rules.status_failed",
    });
  }
});

router.post("/pattern-rules/run", async (req: Request, res: Response) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const state = getState(req);
  if (state.runningUsers.has(userId)) {
    return sendError(
      res,
      new AppError({ status: 409, code: "api.pattern_rules.already_running" })
    );
  }

  try {
    const db = getDb(req);
    const hub = getHub(req);
    const runId = randomUUID();

    state.runningUsers.add(userId);
    const { rules_hash, job } = await startPatternRulesRun({
      db,
      hub,
      runId,
      userId,
    });
    void job
      .catch((error) => {
        logger.errorKey(error, "api.pattern_rules.run_failed");
      })
      .finally(() => {
        state.runningUsers.delete(userId);
      });

    res.status(202).json({ run_id: runId, rules_hash });
  } catch (error) {
    state.runningUsers.delete(userId);
    logger.errorKey(error, "api.pattern_rules.run_failed");
    return sendError(res, error, {
      status: 500,
      code: "api.pattern_rules.run_failed",
    });
  }
});

export default router;
