import { and, asc, eq, exists, or } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { creditBatchProductionRuns, creditBatches, productionRuns, samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { conflictCode } from "@/lib/conflict-ref";
import { formatTimezoneLabel } from "@/lib/date-utils";
import { DomainError } from "@/lib/domain-errors";
import { findTimezoneEntry } from "@/lib/timezones";
import { requireOrgScope } from "./utils";

const FIRST_BLOCKER_LIMIT = 1;

export function facilityTimezoneChangeMessage(
  facilityCode: string,
  batchCode: string,
  currentTimezone: string,
): string {
  return `Facility ${facilityCode} was not saved. Credit batch ${batchCode} holds production runs or Samples dated in this facility's timezone. Set Timezone back to ${formatTimezoneLabel(currentTimezone)} to save your other changes.`;
}

/** Re-picking a stored alias in the combobox does not change the facility zone. */
function isUnchangedFacilityTimezone(current: string, requested: string | undefined): boolean {
  if (requested === undefined || requested === current) return true;
  const currentEntry = findTimezoneEntry(current);
  return currentEntry !== undefined && currentEntry === findTimezoneEntry(requested);
}

/** Resolve the saved zone under the facility row lock; undefined preserves its stored spelling. */
export async function resolveFacilityTimezoneEdit(
  ctx: OrgContext,
  tx: DbTransaction,
  facility: { id: string; code: string; timezone: string },
  requestedTimezone: string | undefined,
): Promise<string | undefined> {
  requireOrgScope(ctx);
  if (isUnchangedFacilityTimezone(facility.timezone, requestedTimezone)) return;

  // Membership and Sample writers hold the facility FOR SHARE before reading
  // facility-local dates. The FOR UPDATE row lock here serializes against them.
  const [batch] = await tx
    .select({ id: creditBatches.id, code: creditBatches.code })
    .from(creditBatches)
    .where(and(
      eq(creditBatches.organizationId, ctx.organizationId),
      or(
        exists(tx.select({ id: creditBatchProductionRuns.productionRunId })
          .from(creditBatchProductionRuns)
          .innerJoin(productionRuns, and(
            eq(productionRuns.id, creditBatchProductionRuns.productionRunId),
            eq(productionRuns.organizationId, ctx.organizationId),
          ))
          .where(and(
            eq(creditBatchProductionRuns.creditBatchId, creditBatches.id),
            eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
            eq(productionRuns.facilityId, facility.id),
          ))),
        and(
          eq(creditBatches.facilityId, facility.id),
          exists(tx.select({ id: samples.id }).from(samples).where(and(
            eq(samples.creditBatchId, creditBatches.id),
            eq(samples.organizationId, ctx.organizationId),
          ))),
        ),
      ),
    ))
    .orderBy(asc(creditBatches.code))
    .limit(FIRST_BLOCKER_LIMIT);

  if (!batch) return requestedTimezone;
  const conflict = { entity: "credit_batch" as const, id: batch.id, code: conflictCode(batch.code) };
  throw new DomainError(
    "conflict",
    facilityTimezoneChangeMessage(facility.code, batch.code, facility.timezone),
    { conflict },
  );
}
