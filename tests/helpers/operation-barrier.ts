import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { DbTransaction } from "@/db";
import * as schema from "@/db/schema";

const LOCK_WAIT_POLL_MS = 20;
const LOCK_WAIT_MAX_POLLS = 100;
const ROLLBACK_REQUESTED = "test barrier rollback requested";

/** A held transaction on a separate connection, as in operation-idempotency. */
export async function openOperationBarrier(pool: Pool) {
  const client = await pool.connect();
  const { rows: [{ pid }] } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
  let finish!: (commit: boolean) => void;
  const decided = new Promise<boolean>((resolve) => { finish = resolve; });
  let ready!: (tx: DbTransaction) => void;
  let failed!: (error: unknown) => void;
  const txReady = new Promise<DbTransaction>((resolve, reject) => { ready = resolve; failed = reject; });
  const done = drizzle(client, { schema }).transaction(async (tx) => {
    ready(tx);
    if (!(await decided)) throw new Error(ROLLBACK_REQUESTED);
  }).catch((error: unknown) => {
    failed(error);
    if (!(error instanceof Error && error.message === ROLLBACK_REQUESTED)) throw error;
  }).finally(() => client.release());
  // Failure before BEGIN must also settle txReady without leaking a rejection.
  void done.catch(() => undefined);
  return {
    tx: await txReady, pid,
    commit: async () => { finish(true); await done; },
    rollback: async () => { finish(false); await done; },
  };
}

/**
 * Scope observation to this blocker, so another suite's wait cannot satisfy it.
 * Waiters count transitively: a second writer on the same row queues behind the
 * first waiter's tuple lock, so PostgreSQL reports the first writer as its blocker.
 */
export async function waitForBlockedOperations(pool: Pool, blockerPid: number, count: number) {
  const observer = await pool.connect();
  try {
    for (let poll = 0; poll < LOCK_WAIT_MAX_POLLS; poll++) {
      const { rows } = await observer.query<{ pid: number }>(
        `with recursive waiters(pid) as (
           select pid from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
              and $1 = any(pg_blocking_pids(pid))
           union
           select activity.pid from pg_stat_activity activity
             join waiters on waiters.pid = any(pg_blocking_pids(activity.pid))
            where activity.datname = current_database() and activity.wait_event_type = 'Lock'
         )
         select pid from waiters`,
        [blockerPid],
      );
      if (rows.length === count) return rows.map((row) => row.pid);
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS));
    }
    throw new Error(`Expected ${count} operations waiting on the test barrier`);
  } finally {
    observer.release();
  }
}
