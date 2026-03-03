export type AppErrorParams = Record<string, unknown>;
export type AppErrorExtra = Record<string, unknown>;

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly params?: AppErrorParams;
  public readonly extra?: AppErrorExtra;

  constructor(opts: {
    code: string;
    status: number;
    params?: AppErrorParams;
    extra?: AppErrorExtra;
    cause?: unknown;
  }) {
    super(opts.code);
    this.code = opts.code;
    this.status = opts.status;
    this.params = opts.params;
    this.extra = opts.extra;
    // TS/lib target may not include ErrorOptions; keep cause in a compatible way.
    if (opts.cause !== undefined) {
      (this as any).cause = opts.cause;
    }
  }
}

export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "status" in error
  );
}
