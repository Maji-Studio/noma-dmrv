/**
 * Typed operation failures (data-entry API plan, section 3.3).
 *
 * Each carries a stable `code` that every adapter renders the same way: a
 * server action's `ActionResult`, a REST problem+json body, an MCP tool error.
 * Thrown with the code, never classified from message text. `DomainError`
 * extends `SafeError`, so `withAction` already shows its message verbatim.
 */

import { z } from "zod";
import { SafeError } from "@/lib/errors";

export type DomainErrorCode =
  | "validation_failed"
  | "not_found"
  | "stale_version"
  | "conflict"
  | "certification_locked"
  | "insufficient_stock"
  | "forbidden"
  | "reference_not_found"
  | "reference_ambiguous"
  // Runner outcomes.
  | "deadline_exceeded"
  | "outcome_unknown"
  | "idempotency_in_progress"
  | "idempotency_key_reused"
  | "key_already_used"
  | "replay_unavailable";

export interface DomainIssue {
  path: (string | number)[];
  code: string;
  message: string;
  /** Non-sensitive limits (`max`, `unit`, allowed values); never the rejected value. */
  meta?: Record<string, unknown>;
}

interface DomainErrorOptions {
  issues?: DomainIssue[];
  retryable?: boolean;
  /** Seconds a client should wait before retrying. */
  retryAfterSeconds?: number;
  cause?: unknown;
}

export class DomainError extends SafeError {
  readonly code: DomainErrorCode;
  readonly issues: DomainIssue[];
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;

  constructor(code: DomainErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.issues = options.issues ?? [];
    this.retryable = options.retryable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

const ISSUE_META_KEYS = ["minimum", "maximum", "inclusive", "divisor", "values", "format"] as const;

function issueMeta(issue: z.core.$ZodIssue): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  const record = issue as unknown as Record<string, unknown>;
  for (const key of ISSUE_META_KEYS) {
    if (record[key] !== undefined) meta[key] = record[key];
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** A Zod failure as a `validation_failed` error that keeps every issue path. */
export function validationFailed(error: z.ZodError): DomainError {
  const issues: DomainIssue[] = error.issues.map((issue) => ({
    path: issue.path.map((segment) =>
      typeof segment === "symbol" ? String(segment) : segment,
    ),
    code: issue.code,
    message: issue.message,
    meta: issueMeta(issue),
  }));
  return new DomainError(
    "validation_failed",
    issues[0]?.message ?? "The request is not valid.",
    { issues },
  );
}
