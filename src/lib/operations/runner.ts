/**
 * The operation runner (data-entry API plan, sections 3.1 and 4).
 *
 * Every exposed write runs through `runOperation`, whichever adapter called
 * it: decode, then one transaction the runner owns, then a typed outcome. The
 * data-access transaction helper owns the connection and destroys clients
 * whose transaction state is unknown.
 *
 * Deadline sequence (the timer alone never stops a transaction):
 * 1. The budget covers pool acquisition. A request whose deadline passes while
 *    it waits for a connection answers `deadline_exceeded` and never starts:
 *    if the connection arrives later it is handed straight back.
 * 2. Statement and transaction timeouts use the remaining budget, so the
 *    server also terminates a run of short statements that would overrun it.
 * 3. The budget is checked again before COMMIT; an overrun rolls back.
 * 4. A failure after COMMIT was sent is `outcome_unknown`: the client retries
 *    with the same idempotency key, which replays the stored result or runs
 *    once. The runner never promises a rollback it cannot prove.
 */

import { readStockBalances, type SnapshotStock } from "@/data-access/stock-effects";
import { diffStockBalances, type StockBalance, type StockEffects } from "@/lib/representations/stock-effects";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";
import type { DbTransaction } from "@/db";
import { pgErrorCode, PG_LOCK_NOT_AVAILABLE, PG_QUERY_CANCELED, PG_DEADLOCK_DETECTED, PG_SERIALIZATION_FAILURE } from "@/db/errors";
import { OPERATION_DEADLINE_MS, OPERATION_MAX_ATTEMPTS, OPERATION_RETRY_MIN_DELAY_MS, OPERATION_RETRY_MAX_DELAY_MS } from "@/config/operations";
import {
  assertIdempotencyKeyUnused,
  claimIdempotencyKey,
  recordIdempotencyOutcome,
} from "@/data-access/api-idempotency-records";
import type { OrgContext } from "@/lib/auth/server";
import { logger, sanitizeErrorMessage } from "@/lib/log";
import { DomainError, validationFailed } from "./errors";
import { runOwnedTransaction } from "@/data-access/owned-transaction";
import { deadlineExceeded, idempotencyInProgress } from "@/lib/domain-errors";
import type { Jsonified } from "./jsonified";
import { writeApiAuditEvent } from "@/data-access/api-audit-events";
import type { OperationEffect } from "@/lib/operation-effect";

export type { OperationEffect } from "@/lib/operation-effect";

/** Version of the request contract folded into idempotency fingerprints. */
const API_CONTRACT_VERSION = "v1";

export interface OperationScope {
  /** Dry-run observer; once per attempt, after locks, before stock changes. */
  snapshotStock?: SnapshotStock;
  ctx: OrgContext;
  tx: DbTransaction;
  /** Work to trigger after the real commit; never after a dry run or rollback. */
  afterCommit: (hook: () => Promise<void> | void) => void;
}

export interface Operation<Input extends z.ZodType, Output> {
  /** Stable id, shared with the REST `operationId` and the MCP tool name. */
  id: string;
  input: Input;
  /** False for operations with irreversible external effects. */
  supportsDryRun: boolean;
  describe?: (input: z.output<Input>, output: Output) => OperationEffect;
  execute: (scope: OperationScope, input: z.output<Input>) => Promise<Output>;
}

export interface IdempotencyOptions {
  credentialId: string;
  key: string;
  /** The resource a PATCH/DELETE/command targets, folded into the fingerprint. */
  target?: string;
  /** The precondition sent (If-Match / expectedVersion). */
  precondition?: string;
}

export interface RunOptions {
  audit?: { transport: "rest" | "mcp"; requestId: string; credentialId: string; oauthClientId?: string | null };
  dryRun?: boolean;
  idempotency?: IdempotencyOptions;
  /** Whole-operation budget in ms; defaults to `OPERATION_DEADLINE_MS`. */
  deadlineMs?: number;
  /** The pool to run on; tests pass a pool of their own size. */
  pool?: Pool;
}

export interface OperationResult<Output> {
  data: Jsonified<Output>;
  effect?: OperationEffect;
  stockEffects?: StockEffects;
  dryRun: boolean;
  replayed: boolean;
}

class DryRunRollback<Output> {
  constructor(readonly data: Output, readonly effect?: OperationEffect, readonly stockEffects?: StockEffects) {}
}

class ReplayRollback {
  constructor(readonly outcome: unknown, readonly effect?: OperationEffect) {}
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const record = nested as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    }
    return nested;
  });
}

/** Fingerprint of what the request asked for, after decoding. */
export function requestFingerprint(
  operationId: string,
  decodedInput: unknown,
  idempotency: Pick<IdempotencyOptions, "target" | "precondition">,
): string {
  return createHash("sha256")
    .update(
      stableJson({
        apiVersion: API_CONTRACT_VERSION,
        operationId,
        input: decodedInput,
        target: idempotency.target ?? null,
        precondition: idempotency.precondition ?? null,
      }),
    )
    .digest("hex");
}

/** The JSON representation a first response and its replay share. */
function toJson<Output>(data: Output): Jsonified<Output> {
  return JSON.parse(JSON.stringify(data) ?? "null") as Jsonified<Output>;
}

function remainingMs(deadlineAt: number): number {
  return deadlineAt - Date.now();
}

const inFlightKeys = new Set<string>();

function inFlightKey(ctx: OrgContext, idempotency: IdempotencyOptions): string {
  return JSON.stringify([ctx.organizationId, idempotency.credentialId, idempotency.key]);
}

function decode<Input extends z.ZodType>(schema: Input, input: unknown): z.output<Input> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  return parsed.data;
}

async function runAfterCommitHooks(
  operationId: string,
  hooks: Array<() => Promise<void> | void>,
): Promise<void> {
  for (const hook of hooks) {
    try {
      await hook();
    } catch (error) {
      // The write is committed; a hook failure must never look like a rollback.
      logger.warn({ errorMessage: sanitizeErrorMessage(error), operationId }, "operation after-commit hook failed");
    }
  }
}

/**
 * Run `operation` for `ctx`: decode `input`, execute in one runner-owned
 * transaction, and return the committed (or dry-run) result.
 */
export async function runOperation<Input extends z.ZodType, Output>(
  operation: Operation<Input, Output>,
  ctx: OrgContext,
  input: unknown,
  options: RunOptions = {},
): Promise<OperationResult<Output>> {
  return runOperationCore(operation, ctx, input, options, toJson<Output>);
}

/** Native results for server actions; replay and previews are JSON-only contracts. */
export async function runOperationInProcess<Input extends z.ZodType, Output>(
  operation: Operation<Input, Output>,
  ctx: OrgContext,
  input: unknown,
  options: Pick<RunOptions, "deadlineMs" | "pool"> & {
    idempotency?: never;
    dryRun?: never;
  } = {},
): Promise<Output> {
  if (options.idempotency !== undefined || options.dryRun !== undefined) {
    throw new DomainError("validation_failed", "In-process operations do not accept idempotency or dry run.");
  }
  try {
    const result = await runOperationCore(operation, ctx, input, options, (data) => data);
    return result.data;
  } catch (error) {
    if (error instanceof DomainError && error.code === "outcome_unknown") {
      // In-process callers have no idempotency key that makes a retry safe.
      throw new DomainError(
        "outcome_unknown",
        "It is not known whether this change was saved. Check the list before trying again.",
        { cause: error },
      );
    }
    throw error;
  }
}

async function runOperationCore<Input extends z.ZodType, Output, Result>(
  operation: Operation<Input, Output>,
  ctx: OrgContext,
  input: unknown,
  options: RunOptions,
  represent: (data: Output) => Result,
): Promise<{ data: Result; effect?: OperationEffect; stockEffects?: StockEffects; dryRun: boolean; replayed: boolean }> {
  const deadlineAt = Date.now() + (options.deadlineMs ?? OPERATION_DEADLINE_MS);
  const dryRun = options.dryRun ?? false;
  const { idempotency } = options;
  if (dryRun && !operation.supportsDryRun) {
    throw new DomainError("validation_failed", "This operation does not offer a dry run.");
  }

  if (options.audit && !operation.describe) throw new Error("Audited operations must describe their effect.");
  const decoded = decode(operation.input, input);

  // Same-instance duplicates answer at once: at pool size 1 the second request
  // would otherwise wait for the first's connection and could not reach the
  // database claim before its deadline.
  const flightKey = idempotency && !dryRun ? inFlightKey(ctx, idempotency) : undefined;
  if (flightKey) {
    if (inFlightKeys.has(flightKey)) {
      throw idempotencyInProgress();
    }
    inFlightKeys.add(flightKey);
  }

  const hooks: Array<() => Promise<void> | void> = [];
  let committed: { data: Result; effect?: OperationEffect; stockEffects?: StockEffects; dryRun: boolean; replayed: boolean } | undefined;
  try {
    for (let attempt = 1; attempt <= OPERATION_MAX_ATTEMPTS; attempt++) {
      if (remainingMs(deadlineAt) <= 0) throw deadlineExceeded("before starting");
      // A rolled-back attempt must not leak hooks into the eventual commit.
      hooks.length = 0;
      const outcome = await runOwnedTransaction(ctx, deadlineAt, async (tx) => {
        let recordId: string | undefined;
        if (idempotency && dryRun) {
          await assertIdempotencyKeyUnused(ctx, tx, idempotency.credentialId, idempotency.key);
        } else if (idempotency) {
          const claim = await claimIdempotencyKey(ctx, tx, {
            credentialId: idempotency.credentialId,
            key: idempotency.key,
            operationId: operation.id,
            fingerprint: requestFingerprint(operation.id, decoded, idempotency),
          });
          if (claim.kind === "replay") throw new ReplayRollback(claim.outcome, claim.effect);
          recordId = claim.recordId;
        }

        let before: StockBalance[] | undefined;
        const snapshotStock: SnapshotStock | undefined = dryRun ? async (writerTx, ids) => {
          before = await readStockBalances(ctx, writerTx, ids);
        } : undefined;
        const output = await operation.execute({ ctx, tx, snapshotStock, afterCommit: (hook) => hooks.push(hook) }, decoded);
        const stockEffects = before ? diffStockBalances(before, await readStockBalances(ctx, tx, before.map((bin) => bin.storageLocationId))) : undefined;
        const effect = operation.describe?.(decoded, output);
        const result = represent(output);
        if (options.audit && !dryRun && effect) {
          await writeApiAuditEvent(ctx, tx, { ...options.audit, operationId: operation.id, effect });
        }
        if (recordId) {
          await recordIdempotencyOutcome(ctx, tx, recordId, result, effect);
        }

        if (remainingMs(deadlineAt) <= 0) throw deadlineExceeded("before saving");
        if (dryRun) throw new DryRunRollback(result, effect, stockEffects);
        return { data: result, ...(effect ? { effect } : {}) };
      }, options.pool);

      if (outcome.kind === "committed") {
        committed = { ...outcome.data, dryRun: false, replayed: false };
        break;
      } else {
        const failure = outcome.error;
        if (failure instanceof DryRunRollback) {
          return { data: failure.data as Result, ...(failure.stockEffects ? { stockEffects: failure.stockEffects } : {}), ...(failure.effect ? { effect: failure.effect } : {}), dryRun: true, replayed: false };
        }
        if (failure instanceof ReplayRollback) {
          return { data: failure.outcome as Result, ...(failure.effect ? { effect: failure.effect } : {}), dryRun: false, replayed: true };
        }
        const code = pgErrorCode(failure);
        if ((code === PG_QUERY_CANCELED || code === PG_LOCK_NOT_AVAILABLE) && remainingMs(deadlineAt) <= 0) {
          throw deadlineExceeded("while saving");
        }
        // Claim waits have their own short budget and must remain "still running".
        const claimLockTimeout = failure instanceof DomainError && failure.code === "idempotency_in_progress";
        // Only callback_threw proves COMMIT was never sent and the claim rolled back.
        if (code === PG_DEADLOCK_DETECTED || code === PG_SERIALIZATION_FAILURE ||
          (code === PG_LOCK_NOT_AVAILABLE && !claimLockTimeout)) {
          if (remainingMs(deadlineAt) <= 0) throw deadlineExceeded("while saving");
          if (attempt === OPERATION_MAX_ATTEMPTS) {
            throw new DomainError("concurrent_write_retry", "Concurrent changes prevented saving. Retry shortly.", { retryable: true });
          }
          const delayMs = OPERATION_RETRY_MIN_DELAY_MS + Math.floor(
            Math.random() * (OPERATION_RETRY_MAX_DELAY_MS - OPERATION_RETRY_MIN_DELAY_MS + 1),
          );
          if (remainingMs(deadlineAt) <= delayMs) throw deadlineExceeded("before retrying");
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          if (remainingMs(deadlineAt) <= 0) throw deadlineExceeded("before retrying");
          logger.warn({ operationId: operation.id, attempt: attempt + 1, sqlstate: code }, "operation transaction retry");
          continue;
        }
        throw failure;
      }
    }
  } finally {
    if (flightKey) inFlightKeys.delete(flightKey);
  }

  if (!committed) throw new Error("operation finished without a result");
  // Hooks run once the connection is back in the pool and the key is free: at
  // pool size 1 a hook reading through `db` would otherwise wait on this
  // request's own connection.
  await runAfterCommitHooks(operation.id, hooks);
  return committed;
}
