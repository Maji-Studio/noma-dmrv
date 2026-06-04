import { env } from "@/config/env";

/**
 * Minimal structured server-side logger.
 *
 * Emits newline-delimited JSON to stdout/stderr (which Vercel captures), with
 * level filtering, child bindings, and field redaction. Intentionally
 * dependency-free: pino is the obvious choice, but Next.js 16's Turbopack has an
 * open, unresolved bug (vercel/next.js#93849) where a `serverExternalPackages`
 * package's hashed alias isn't resolvable at Vercel's serverless runtime —
 * independent of transport config and not catchable by local testing. A ~50-line
 * in-house logger covers our needs (levels, child bindings, redact) with none of
 * that risk. Swap to pino if/when that bug is fixed and the build leaves
 * Turbopack.
 *
 * Server-only by contract: import only from server code (the isometric client
 * boundary and `fn/` server actions), never a client component.
 *
 * `redact` enforces the no-PII / no-secret rule (CLAUDE.md): any field whose key
 * matches a redacted name is censored even if a caller passes it by accident.
 * Prefer passing IDs (userId, removalId) over PII regardless — redact is the
 * backstop, not the primary control.
 */
type Level = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_ORDER: Record<Level, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};
const SILENT = Number.POSITIVE_INFINITY;

const isProd = process.env.NODE_ENV === "production";
const configured = env.LOG_LEVEL ?? (isProd ? "info" : "debug");
const threshold = configured === "silent" ? SILENT : LEVEL_ORDER[configured];

// Case-insensitive key match (covers `email`, `Authorization`, `X-Client-Secret`,
// `accessToken`, etc., at any nesting depth).
const REDACT_KEYS = new Set([
  "email",
  "password",
  "token",
  "accesstoken",
  "clientsecret",
  "secret",
  "authorization",
  "x-client-secret",
]);
const REDACTED = "[REDACTED]";

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACT_KEYS.has(key.toLowerCase())
      ? REDACTED
      : redact(val, seen);
  }
  return out;
}

interface LogFn {
  (obj: Record<string, unknown>, msg?: string): void;
  (msg: string): void;
}

export interface Logger {
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  /** Returns a logger that merges `bindings` into every record it emits. */
  child(bindings: Record<string, unknown>): Logger;
}

function emit(
  level: Level,
  bindings: Record<string, unknown>,
  a?: Record<string, unknown> | string,
  b?: string,
): void {
  if (LEVEL_ORDER[level] < threshold) return;
  const obj = typeof a === "object" && a !== null ? a : {};
  const msg = typeof a === "string" ? a : b;
  // Redact child bindings too — a `logger.child({...})` caller could pass a
  // sensitive key by accident, and the backstop must cover that path as well
  // as the per-call payload.
  const redactedBindings = redact(bindings) as Record<string, unknown>;
  const record = {
    level,
    time: new Date().toISOString(),
    ...redactedBindings,
    ...(redact(obj) as Record<string, unknown>),
    ...(msg !== undefined ? { msg } : {}),
  };
  const line = JSON.stringify(record);
  // error/fatal → stderr (console.error); everything else → stdout. Vercel
  // captures both streams.
  if (level === "error" || level === "fatal") console.error(line);
  else console.log(line);
}

function makeLogger(bindings: Record<string, unknown>): Logger {
  const at =
    (level: Level): LogFn =>
    (a?: Record<string, unknown> | string, b?: string) =>
      emit(level, bindings, a, b);
  return {
    trace: at("trace"),
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    fatal: at("fatal"),
    child: (extra) => makeLogger({ ...bindings, ...extra }),
  };
}

export const logger: Logger = makeLogger({});
