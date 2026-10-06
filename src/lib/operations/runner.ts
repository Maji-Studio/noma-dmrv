/**
 * The operation runner (data-entry API plan, sections 3.1 and 4).
 *
 * Every exposed write runs through `runOperation`, whichever adapter called
 * it: decode, then one transaction the runner owns, then a typed outcome. The
 * runner checks out its own connection instead of `db.transaction`, because
 * Drizzle returns a client to the pool even when ROLLBACK failed; here a
 * client in an unknown state is destroyed.
 *
 * Deadline sequence (the timer alone never stops a transaction):
 * 1. The budget covers pool acquisition. A request whose deadline passes while
 *    it waits for a connection answers `deadline_exceeded` and never starts:
 *    if the connection arrives later it is handed straight back.
 * 2. Once the transaction starts, `statement_timeout` is the remaining budget,
 *    so PostgreSQL cancels a statement that would overrun it.
 * 3. The budget is checked again before COMMIT; an overrun rolls back.
 * 4. A failure after COMMIT was sent is `outcome_unknown`: the client retries
 *    with the same idempotency key, which replays the stored result or runs
 *    once. The runner never promises a rollback it cannot prove.
 */

import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { db, type DbTransaction } from "@/db";
import * as schema from "@/db/schema";
import { pgErrorCode, PG_LOCK_NOT_AVAILABLE, PG_QUERY_CANCELED } from "@/db/errors";
import { OPERATION_DEADLINE_MS } from "@/config/operations";
import {
  assertIdempotencyKeyUnused,
  claimIdempotencyKey,
  recordIdempotencyOutcome,
} from "@/data-access/api-idempotency-records";
import type { OrgContext } from "@/lib/auth/server";
import { logger } from "@/lib/log";
import { DomainError, validationFailed } from "./errors";

/** SQLSTATE classes whose COMMIT failure proves the transaction rolled back. */
const DEFINITE_ROLLBACK_SQLSTATE_CLASSES = ["23", "40"];
/** Version of the request contract folded into idempotency fingerprints. */
const API_CONTRACT_VERSION = "v1";

export interface OperationScope {
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
  dryRun?: boolean;
  idempotency?: IdempotencyOptions;
  /** Whole-operation budget in ms; defaults to `OPERATION_DEADLINE_MS`. */
  deadlineMs?: number;
  /** The pool to run on; tests pass a pool of their own size. */
  pool?: Pool;
}

export interface OperationResult<Output> {
  data: Output;
  dryRun: boolean;
  replayed: boolean;
}

class DryRunRollback<Output> {
  constructor(readonly data: Output) {}
}

class ReplayRollback {
  constructor(readonly outcome: unknown) {}
}

function deadlineExceeded(detail: string): DomainError {
  return new DomainError(
    "deadline_exceeded",
    `The request ran out of time ${detail}. Nothing was saved; retry it.`,
    { retryable: true },
  );
}

function outcomeUnknown(cause: unknown): DomainError {
  return new DomainError(
    "outcome_unknown",
    "The connection failed while saving, so it is not known whether the change was saved. Retry with the same idempotency key.",
    { retryable: true, cause },
  );
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
function toStoredOutcome<Output>(data: Output): Output {
  return JSON.parse(JSON.stringify(data ?? null)) as Output;
}

function remainingMs(deadlineAt: number): number {
  return deadlineAt - Date.now();
}

/**
 * Check out a connection before the deadline, or answer without starting. A
 * connection that arrives after the answer is released untouched.
 */
async function acquireBeforeDeadline(pool: Pool, deadlineAt: number): Promise<PoolClient> {
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connecting = pool.connect().then((client) => {
    if (abandoned) {
      client.release();
      return undefined;
    }
    return client;
  });
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), Math.max(0, remainingMs(deadlineAt)));
  });
  try {
    const winner = await Promise.race([connecting, timedOut]);
    if (winner === "timeout" || winner === undefined) {
      abandoned = true;
      // A late connection is released by the handler above; a late failure
      // has nobody left to report to.
      connecting.catch(() => undefined);
      throw deadlineExceeded("while waiting for a database connection");
    }
    return winner;
  } finally {
    clearTimeout(timer);
  }
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

function isDefiniteRollback(error: unknown): boolean {
  const code = pgErrorCode(error);
  return code !== undefined && DEFINITE_ROLLBACK_SQLSTATE_CLASSES.includes(code.slice(0, 2));
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
      logger.warn({ err: error, operationId }, "operation after-commit hook failed");
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
  const deadlineAt = Date.now() + (options.deadlineMs ?? OPERATION_DEADLINE_MS);
  const dryRun = options.dryRun ?? false;
  const { idempotency } = options;
  if (dryRun && !operation.supportsDryRun) {
    throw new DomainError("validation_failed", "This operation does not offer a dry run.");
  }

  const decoded = decode(operation.input, input);

  // Same-instance duplicates answer at once: at pool size 1 the second request
  // would otherwise wait for the first's connection and could not reach the
  // database claim before its deadline.
  const flightKey = idempotency && !dryRun ? inFlightKey(ctx, idempotency) : undefined;
  if (flightKey) {
    if (inFlightKeys.has(flightKey)) {
      throw new DomainError(
        "idempotency_in_progress",
        "A request with this idempotency key is still running. Retry shortly.",
        { retryable: true, retryAfterSeconds: 1 },
      );
    }
    inFlightKeys.add(flightKey);
  }

  try {
    const client = await acquireBeforeDeadline(options.pool ?? db.$client, deadlineAt);
    const hooks: Array<() => Promise<void> | void> = [];
    // Mutated inside the transaction callback; an object so the catch below
    // reads the live value rather than a narrowed literal.
    const state: { callback: "pending" | "returned" | "threw"; thrown?: unknown } = {
      callback: "pending",
    };
    let discardClient: Error | undefined;

    try {
      const connection = drizzle(client, { schema });
      const data = await connection.transaction(async (tx) => {
        try {
          const budget = Math.floor(remainingMs(deadlineAt));
          if (budget <= 0) throw deadlineExceeded("before it started");
          await tx.execute(sql.raw(`set local statement_timeout = ${budget}`));

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
            if (claim.kind === "replay") throw new ReplayRollback(claim.outcome);
            recordId = claim.recordId;
          }

          let result = await operation.execute(
            { ctx, tx, afterCommit: (hook) => hooks.push(hook) },
            decoded,
          );
          if (recordId) {
            result = toStoredOutcome(result);
            await recordIdempotencyOutcome(ctx, tx, recordId, result);
          }

          if (remainingMs(deadlineAt) <= 0) throw deadlineExceeded("before saving");
          if (dryRun) throw new DryRunRollback(result);
          state.callback = "returned";
          return result;
        } catch (error) {
          state.callback = "threw";
          state.thrown = error;
          throw error;
        }
      });

      await runAfterCommitHooks(operation.id, hooks);
      return { data, dryRun: false, replayed: false };
    } catch (error) {
      const cleanRollback = state.callback === "threw" && error === state.thrown;
      if (!cleanRollback) {
        // BEGIN, ROLLBACK or COMMIT itself failed: the connection's state is
        // unknown, so it is destroyed instead of returned to the pool.
        discardClient = error instanceof Error ? error : new Error(String(error));
      }
      if (state.callback === "returned") {
        throw isDefiniteRollback(error) ? error : outcomeUnknown(error);
      }
      if (state.callback === "pending") throw error;

      // The callback threw. Even when ROLLBACK then failed, nothing committed:
      // PostgreSQL aborts an open transaction when its connection dies.
      const failure = state.thrown;
      if (failure instanceof DryRunRollback) {
        return { data: failure.data as Output, dryRun: true, replayed: false };
      }
      if (failure instanceof ReplayRollback) {
        return { data: failure.outcome as Output, dryRun: false, replayed: true };
      }
      const code = pgErrorCode(failure);
      if ((code === PG_QUERY_CANCELED || code === PG_LOCK_NOT_AVAILABLE) && remainingMs(deadlineAt) <= 0) {
        throw deadlineExceeded("while saving");
      }
      throw failure;
    } finally {
      client.release(discardClient);
    }
  } finally {
    if (flightKey) inFlightKeys.delete(flightKey);
  }
}
