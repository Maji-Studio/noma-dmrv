import { and, asc, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { creditBatchProductionRuns, creditBatches, productionRuns } from "@/db/schema";
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
  return `Facility ${facilityCode} was not saved. Credit batch ${batchCode} holds production runs dated in this facility's timezone. Set Timezone back to ${formatTimezoneLabel(currentTimezone)} to save your other changes.`;
}

/** Re-picking a stored alias in the combobox does not change the facility zone. */
export function isUnchangedFacilityTimezone(current: string, requested: string | undefined): boolean {
  if (requested === undefined || requested === current) return true;
  const currentEntry = findTimezoneEntry(current);
  return currentEntry !== undefined && currentEntry === findTimezoneEntry(requested);
}

/** Call with the facility row locked, before writing either tier or ordinary edits. */
export async function assertFacilityTimezoneChangeAllowed(
  ctx: OrgContext,
  tx: DbTransaction,
  facility: { id: string; code: string; timezone: string },
  requestedTimezone: string | undefined,
): Promise<void> {
  requireOrgScope(ctx);
  if (isUnchangedFacilityTimezone(facility.timezone, requestedTimezone)) return;

  // Residual race: run auto-attachment without a facility edit can insert after
  // this read. Locking runs here could deadlock with writers that hold a run
  // before taking facility FK locks; membership writers keep their lock order.
  const [batch] = await tx
    .select({ id: creditBatches.id, code: creditBatches.code })
    .from(creditBatchProductionRuns)
    .innerJoin(productionRuns, and(
      eq(productionRuns.id, creditBatchProductionRuns.productionRunId),
      eq(productionRuns.organizationId, ctx.organizationId),
    ))
    .innerJoin(creditBatches, and(
      eq(creditBatches.id, creditBatchProductionRuns.creditBatchId),
      eq(creditBatches.organizationId, ctx.organizationId),
    ))
    .where(and(
      eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      eq(productionRuns.facilityId, facility.id),
    ))
    .orderBy(asc(creditBatches.code))
    .limit(FIRST_BLOCKER_LIMIT);

  if (!batch) return;
  const conflict = { entity: "credit_batch" as const, id: batch.id, code: conflictCode(batch.code) };
  throw new DomainError(
    "conflict",
    facilityTimezoneChangeMessage(facility.code, batch.code, facility.timezone),
    { conflict },
  );
}
