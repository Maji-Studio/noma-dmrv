import { sql } from "drizzle-orm";
import {
  withDedicatedLockConnection,
  withDedicatedSessionAdvisoryLock,
  type DbTransaction,
} from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

const FACILITY_DURABILITY_LOCK_SCOPE = "facility-durability-tier";

function facilityDurabilityLockKey(
  ctx: OrgContext,
  facilityId: string,
): string {
  return `${FACILITY_DURABILITY_LOCK_SCOPE}:${ctx.organizationId}:${facilityId}`;
}

/**
 * Serialize durability-tier edits with writes that make a facility
 * consequential. Callers must acquire this before any narrower mapping,
 * certification-artifact, or mirror lock.
 */
export async function acquireFacilityDurabilityLock(
  ctx: OrgContext,
  tx: DbTransaction,
  facilityId: string,
): Promise<void> {
  requireOrgScope(ctx);
  const lockKey = facilityDurabilityLockKey(ctx, facilityId);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );
}

/**
 * Serialize facility durability work while allowing short writes to commit
 * before an external HTTP call. The session lock uses the same advisory key
 * as `acquireFacilityDurabilityLock`, so transaction-lock callers also wait.
 */
export async function withFacilityDurabilitySessionLock<T>(
  ctx: OrgContext,
  facilityId: string,
  fn: () => Promise<T>,
): Promise<T> {
  requireOrgScope(ctx);
  return withDedicatedSessionAdvisoryLock(
    facilityDurabilityLockKey(ctx, facilityId),
    fn,
  );
}

/**
 * Run facility-serialized work in one transaction on a dedicated connection.
 * Registry reconciliation may hold the lock across HTTP; keeping that work
 * off the shared app pool prevents a waiter from starving the lock holder.
 */
export async function withFacilityDurabilityLock<T>(
  ctx: OrgContext,
  facilityId: string,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  requireOrgScope(ctx);
  return withDedicatedLockConnection(async (tx) => {
    await acquireFacilityDurabilityLock(ctx, tx, facilityId);
    return fn(tx);
  });
}
