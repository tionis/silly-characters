import type Database from "better-sqlite3";
import { AppError } from "../errors/app-error";

export type PatternRuleType = "regex";

export interface PatternRule {
  id: string;
  label?: string;
  type: PatternRuleType;
  pattern: string;
  enabled: boolean;
  flags: string;
  caseSensitive?: boolean;
}

export interface PatternRulesFile {
  version: 1;
  rules: PatternRule[];
  updatedAt: number;
}

const DEFAULT_PATTERN_RULES: PatternRulesFile = {
  version: 1,
  rules: [],
  updatedAt: 0,
};

function normalizeUserId(userId?: string | null): string | null {
  const normalized = typeof userId === "string" ? userId.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeFlags(
  raw: string,
  opts?: { caseSensitive?: boolean }
): string {
  const trimmed = raw.trim();
  const wantInsensitive = opts?.caseSensitive === false;
  const hasI = trimmed.includes("i");
  const base = wantInsensitive && !hasI ? `${trimmed}i` : trimmed;

  const seen = new Set<string>();
  let out = "";
  for (const ch of base) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    out += ch;
  }
  return out;
}

function validateRule(rule: PatternRule): void {
  const id = typeof rule.id === "string" ? rule.id.trim() : "";
  if (!id) {
    throw new AppError({
      status: 400,
      code: "api.pattern_rules.invalid_rules",
    });
  }
  if (rule.type !== "regex") {
    throw new AppError({
      status: 400,
      code: "api.pattern_rules.invalid_rules",
    });
  }

  const pattern = typeof rule.pattern === "string" ? rule.pattern : "";
  if (pattern.trim().length === 0) {
    throw new AppError({
      status: 400,
      code: "api.pattern_rules.invalid_rules",
    });
  }

  if (typeof rule.enabled !== "boolean") {
    throw new AppError({
      status: 400,
      code: "api.pattern_rules.invalid_rules",
    });
  }

  const flagsRaw = typeof rule.flags === "string" ? rule.flags : "";
  const flags = normalizeFlags(flagsRaw, { caseSensitive: rule.caseSensitive });

  if (!/^[dgimsuvy]*$/.test(flags)) {
    throw new AppError({
      status: 400,
      code: "api.pattern_rules.invalid_rules",
    });
  }

  // eslint-disable-next-line no-new
  new RegExp(pattern, flags);
}

export function validatePatternRulesFile(
  value: unknown
): asserts value is PatternRulesFile {
  const obj = value as PatternRulesFile | null;
  if (!obj || typeof obj !== "object") {
    throw new AppError({
      status: 400,
      code: "api.pattern_rules.invalid_rules",
    });
  }
  if (obj.version !== 1) {
    throw new AppError({
      status: 400,
      code: "api.pattern_rules.invalid_rules",
    });
  }
  if (!Array.isArray(obj.rules)) {
    throw new AppError({
      status: 400,
      code: "api.pattern_rules.invalid_rules",
    });
  }

  for (const r of obj.rules) {
    validateRule(r as PatternRule);
  }
}

type PatternRulesRow = { rules_json: string };

function upsertPatternRulesRow(
  db: Database.Database,
  userId: string,
  value: PatternRulesFile
): void {
  const now = Date.now();
  db.prepare(
    `
      INSERT INTO user_pattern_rules (user_id, rules_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        rules_json = excluded.rules_json,
        updated_at = excluded.updated_at
    `
  ).run(userId, JSON.stringify(value), now);
}

export async function getPatternRules(
  db: Database.Database,
  userId?: string | null
): Promise<PatternRulesFile> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return DEFAULT_PATTERN_RULES;
  }

  const row = db
    .prepare(
      `
        SELECT rules_json
        FROM user_pattern_rules
        WHERE user_id = ?
        LIMIT 1
      `
    )
    .get(normalizedUserId) as PatternRulesRow | undefined;

  if (row?.rules_json) {
    try {
      const parsed = JSON.parse(row.rules_json) as unknown;
      validatePatternRulesFile(parsed);
      return parsed as PatternRulesFile;
    } catch {
      return DEFAULT_PATTERN_RULES;
    }
  }

  const initial = DEFAULT_PATTERN_RULES;
  upsertPatternRulesRow(db, normalizedUserId, initial);
  return initial;
}

export async function updatePatternRules(
  db: Database.Database,
  userId: string | null,
  raw: unknown
): Promise<PatternRulesFile> {
  const normalizedUserId = normalizeUserId(userId);

  const obj = raw as { rules?: unknown } | null;
  const rules = Array.isArray(raw)
    ? raw
    : Array.isArray(obj?.rules)
    ? obj?.rules
    : [];

  const normalizedRules: PatternRule[] = rules.map((r) => {
    const id = typeof r?.id === "string" ? r.id.trim() : "";
    const label = typeof r?.label === "string" ? r.label.trim() : undefined;
    const pattern = typeof r?.pattern === "string" ? r.pattern : "";
    const enabled = r?.enabled === true;
    const flagsRaw = typeof r?.flags === "string" ? r.flags : "";
    const flags = normalizeFlags(flagsRaw, {
      caseSensitive: (r as any)?.caseSensitive,
    });

    const out: PatternRule = {
      id,
      label: label && label.length > 0 ? label : undefined,
      type: "regex",
      pattern,
      enabled,
      flags,
    };

    if (typeof (r as any)?.caseSensitive === "boolean") {
      out.caseSensitive = (r as any).caseSensitive;
    }

    validateRule(out);
    return out;
  });

  const next: PatternRulesFile = {
    version: 1,
    rules: normalizedRules,
    updatedAt: Date.now(),
  };

  if (!normalizedUserId) {
    return next;
  }

  upsertPatternRulesRow(db, normalizedUserId, next);
  return next;
}
