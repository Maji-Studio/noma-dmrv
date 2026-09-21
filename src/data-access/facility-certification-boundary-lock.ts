import { sql } from "drizzle-orm";
import {
  withDedicatedSessionAdvisoryLock,
  type DbTransaction,
} from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

const LOCK_SCOPE = "facility-certification-boundary";

function lockKey(ctx: OrgContext, facilityId: string): string {
  return `${LOCK_SCOPE}:${ctx.organizationId}:${facilityId}`;
}

export async function acquireFacilityCertificationBoundaryLock(
  ctx: OrgContext,
  tx: DbTransaction,
  facilityId: string,
): Promise<void> {
  requireOrgScope(ctx);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey(ctx, facilityId)}, 0))`,
  );
}

export async function withFacilityCertificationBoundarySessionLock<T>(
  ctx: OrgContext,
  facilityId: string,
  fn: () => Promise<T>,
): Promise<T> {
  requireOrgScope(ctx);
  return withDedicatedSessionAdvisoryLock(lockKey(ctx, facilityId), fn);
}
