import type { Response } from "express";
import { t } from "../i18n/i18n";
import { AppError, isAppError } from "./app-error";

export type ErrorResponseBody = {
  /** Backward-compatible human-readable message */
  error: string;
  /** Stable machine-readable code */
  code: string;
  /** Optional params for i18n interpolation */
  params?: Record<string, unknown>;
} & Record<string, unknown>;

export function sendError(
  res: Response,
  err: unknown,
  fallback?: {
    status?: number;
    code?: string;
    params?: Record<string, unknown>;
    extra?: Record<string, unknown>;
  }
): Response {
  const appErr: AppError = isAppError(err)
    ? (err as AppError)
    : new AppError({
        status: fallback?.status ?? 500,
        code: fallback?.code ?? "api.internal",
        params: fallback?.params,
        extra: fallback?.extra,
        cause: err,
      });

  const message = t(appErr.code, appErr.params);
  const body: ErrorResponseBody = {
    error: message,
    code: appErr.code,
    ...(appErr.params ? { params: appErr.params } : {}),
    ...(appErr.extra ? appErr.extra : {}),
  };

  return res.status(appErr.status).json(body);
}
