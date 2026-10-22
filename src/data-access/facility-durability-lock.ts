import { sql } from "drizzle-orm";
import {
  withDedicatedLockConnection,
  withDedicatedSessionAdvisoryLock,
  type DbTransaction,
} from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";
import { acquireFacilityCertificationBoundaryLock } from "./facility-certification-boundary-lock";

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

/**
 * Acquire the certification boundary lock, then durability, on `tx`. Every
 * certification submit path takes them in this order. Pass
 * `boundaryLockHeld` when the caller already holds boundary, on this
 * transaction or as a session lock on another connection: requesting it again
 * from a different connection would wait on the caller itself.
 */
export async function acquireFacilityCertificationLocks(
  ctx: OrgContext,
  tx: DbTransaction,
  facilityId: string,
  options: { boundaryLockHeld?: true } = {},
): Promise<void> {
  requireOrgScope(ctx);
  if (!options.boundaryLockHeld) {
    await acquireFacilityCertificationBoundaryLock(ctx, tx, facilityId);
  }
  await acquireFacilityDurabilityLock(ctx, tx, facilityId);
}

/** Run work on a dedicated transaction holding boundary, then durability. */
export async function withFacilityCertificationLocks<T>(
  ctx: OrgContext,
  facilityId: string,
  fn: (tx: DbTransaction) => Promise<T>,
  options: { boundaryLockHeldBySession?: true } = {},
): Promise<T> {
  requireOrgScope(ctx);
  return withDedicatedLockConnection(async (tx) => {
    await acquireFacilityCertificationLocks(ctx, tx, facilityId, {
      boundaryLockHeld: options.boundaryLockHeldBySession,
    });
    return fn(tx);
  });
}
