/**
 * Budgets for the operation runner (data-entry API plan, sections 4 and 7).
 *
 * The application budget sits under the route's `maxDuration` (30 s) so a
 * request always answers before the platform kills it.
 */

/** Whole-operation budget: pool acquisition, every statement and the commit. */
export const OPERATION_DEADLINE_MS = 10_000;

/**
 * How long an idempotency claim waits on another transaction holding the same
 * key before answering "still running". Short on purpose: the waiting request
 * holds a pooled connection.
 */
export const IDEMPOTENCY_CLAIM_LOCK_TIMEOUT_MS = 500;

/** Seconds a client should wait before retrying a key that is still running. */
export const IDEMPOTENCY_RETRY_AFTER_SECONDS = 1;

/**
 * How long a committed outcome replays. Stored outcomes can hold organization
 * data (contact names), so retention is short; offline mobile raises it.
 */
export const IDEMPOTENCY_RETENTION_DAYS = 7;

/** Version of the stored outcome shape; bump with a compatibility mapper. */
export const IDEMPOTENCY_OUTCOME_SCHEMA_VERSION = 1;
