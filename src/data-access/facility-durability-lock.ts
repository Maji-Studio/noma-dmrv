import { sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

const FACILITY_DURABILITY_LOCK_SCOPE = "facility-durability-tier";

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
  const lockKey = `${FACILITY_DURABILITY_LOCK_SCOPE}:${ctx.organizationId}:${facilityId}`;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );
}
