import type { ConflictRef } from "@/lib/conflict-ref";
import { SafeError } from "@/lib/errors";
import type { StockEffect } from "@/lib/representations/stock-effects";
import { IDEMPOTENCY_RETRY_AFTER_SECONDS } from "@/config/operations";

export type DomainErrorCode =
  | "validation_failed"
  | "not_found"
  | "stale_version"
  | "conflict"
  | "certification_locked"
  | "insufficient_stock"
  | "stock_basis_changed"
  | "forbidden"
  | "reference_not_found"
  | "reference_ambiguous"
  // Runner outcomes.
  | "concurrent_write_retry"
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

/** A fresh dry run answering `stock_basis_changed`: write again against this basis. */
export interface StockPreview {
  basisFingerprint: string;
  stockEffects: StockEffect[];
  allocations?: unknown[];
}

interface DomainErrorOptions {
  conflict?: ConflictRef;
  blockers?: ConflictRef[];
  issues?: DomainIssue[];
  retryable?: boolean;
  /** Seconds a client should wait before retrying. */
  retryAfterSeconds?: number;
  /** Only on `stock_basis_changed`, when the adapter could compute the current preview. */
  preview?: StockPreview;
  cause?: unknown;
}

export class DomainError extends SafeError {
  readonly conflict?: ConflictRef;
  readonly blockers?: ConflictRef[];
  readonly code: DomainErrorCode;
  readonly issues: DomainIssue[];
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly preview?: StockPreview;

  constructor(code: DomainErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.conflict = options.conflict;
    this.blockers = options.blockers;
    this.issues = options.issues ?? [];
    this.retryable = options.retryable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.preview) this.preview = options.preview;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function idempotencyInProgress(cause?: unknown): DomainError {
  return new DomainError(
    "idempotency_in_progress",
    "A request with this idempotency key is still running. Retry shortly.",
    { retryable: true, retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_SECONDS, cause },
  );
}

/** The budget ran out before the write could commit; nothing was saved. */
export function deadlineExceeded(detail: string, cause?: unknown): DomainError {
  return new DomainError(
    "deadline_exceeded",
    `The request ran out of time ${detail}. Nothing was saved; retry it.`,
    { retryable: true, cause },
  );
}
