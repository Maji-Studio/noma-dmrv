/** Owns connection lifetime, deadline setup and transaction failure classification. */
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import { db, type DbTransaction } from "@/db";
import * as schema from "@/db/schema";
import { pgErrorCode } from "@/db/errors";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError, deadlineExceeded } from "@/lib/domain-errors";
import { requireOrgScope } from "./utils";

const DEFINITE_ROLLBACK_SQLSTATE_CLASSES = ["23", "40"];

function outcomeUnknown(cause: unknown): DomainError {
  return new DomainError(
    "outcome_unknown",
    "The connection failed while saving, so it is not known whether the change was saved. Retry with the same idempotency key.",
    { retryable: true, cause },
  );
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

function isDefiniteRollback(error: unknown): boolean {
  const code = pgErrorCode(error);
  return code !== undefined && DEFINITE_ROLLBACK_SQLSTATE_CLASSES.includes(code.slice(0, 2));
}

type TransactionResult<T> =
  | { kind: "committed"; data: T }
  | { kind: "callback_threw"; error: unknown };

/** Releases or destroys the connection before reporting the callback outcome. */
export async function runOwnedTransaction<T>(
  ctx: OrgContext,
  deadlineAt: number,
  callback: (tx: DbTransaction) => Promise<T>,
  pool: Pool = db.$client,
): Promise<TransactionResult<T>> {
  requireOrgScope(ctx);
  const client = await acquireBeforeDeadline(pool, deadlineAt);
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
        const result = await callback(tx);
        if (remainingMs(deadlineAt) <= 0) throw deadlineExceeded("before saving");
        state.callback = "returned";
        return result;
      } catch (error) {
        state.callback = "threw";
        state.thrown = error;
        throw error;
      }
    });
    return { kind: "committed", data };
  } catch (error) {
    const cleanRollback = state.callback === "threw" && error === state.thrown;
    if (!cleanRollback) {
      // BEGIN, ROLLBACK or COMMIT failed; never return an uncertain client.
      discardClient = error instanceof Error ? error : new Error(String(error));
    }
    if (state.callback === "returned") {
      throw isDefiniteRollback(error) ? error : outcomeUnknown(error);
    }
    if (state.callback === "pending") throw error;
    // A failed rollback destroys the connection, aborting its open transaction.
    return { kind: "callback_threw", error: state.thrown };
  } finally {
    client.release(discardClient);
  }
}
