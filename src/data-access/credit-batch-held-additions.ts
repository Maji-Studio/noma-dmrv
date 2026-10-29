import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { facilities } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { removalSplitsApplicationsByBatch } from "@/lib/certification/removal-application-policy";
import { DomainError } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";
import { recordLocks, withRecordLockGuidance } from "@/lib/record-lock";
import {
  findMatchingUnassignedProductionRunIds,
  validateProductionRunIds,
  type LockedCreditBatchProductionRun,
} from "./credit-batch-membership";
import { requireOrgScope } from "./utils";
import { loadProductionRunHoldingAllocations, pickCreditBatchRunHoldingAllocation } from "./credit-batch-run-fit";

/** Reuse automatic membership eligibility, including archive and per-run type checks. */
export async function assertAddedCreditBatchRunsFit(
  ctx: OrgContext,
  tx: DbTransaction,
  creditBatchId: string,
  cohort: Parameters<typeof findMatchingUnassignedProductionRunIds>[2],
  currentRunIds: readonly string[],
  nextRunIds: readonly string[],
  lockedRuns: readonly LockedCreditBatchProductionRun[],
): Promise<void> {
  requireOrgScope(ctx);
  const current = new Set(currentRunIds);
  const addedIds = nextRunIds.filter(id => !current.has(id));
  const eligible = new Set(await findMatchingUnassignedProductionRunIds(ctx, tx, cohort));
  // Ordinary validation has already supplied the existing facility, date,
  // completion, assignment and feedstock errors. Ineligible (e.g. archived or
  // untyped) additions use the existing selected-run-not-found refusal.
  await validateProductionRunIds(ctx, tx, addedIds, cohort.facilityId, cohort.certifier,
    cohort.startDate, cohort.endDate, undefined,
    lockedRuns.filter(run => addedIds.includes(run.id) && eligible.has(run.id)));
  if (addedIds.length === 0) return;

  const [facility] = await tx.select({ durabilityOption: facilities.durabilityOption })
    .from(facilities)
    .where(and(eq(facilities.id, cohort.facilityId), eq(facilities.organizationId, ctx.organizationId)));
  if (!facility) throw new SafeError("Facility not found.");
  const splitsApplicationsByBatch = removalSplitsApplicationsByBatch(facility.durabilityOption);

  // The caller holds lineage artifacts, the requested runs and the batch.
  // Application writers serialize on those locks before changing allocations.
  // Reconciliation cannot enlarge an assigned slice. Unless Applications split
  // by batch, it also cannot create an unassigned sibling of a held slice.
  const allocations = await loadProductionRunHoldingAllocations(ctx, tx, addedIds);
  const assignedSlice = pickCreditBatchRunHoldingAllocation(allocations, addedIds,
    creditBatchId, splitsApplicationsByBatch);
  if (!assignedSlice) return;
  const lock = recordLocks.creditBatch({ removals: [], dependents: [{ kind: "removal", id: assignedSlice.removalId }] });
  throw new DomainError("certification_locked", withRecordLockGuidance(
    assignedSlice.creditBatchId === creditBatchId
      ? "Cannot change this credit batch's production membership because its applied mass belongs to a Removal."
      : "Cannot add this run because its biochar is in an Application a Removal already holds through another credit batch.", lock));
}
