import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { applicationOutputAllocations, creditBatchApplications } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { recordLocks, withRecordLockGuidance } from "@/lib/record-lock";
import {
  findMatchingUnassignedProductionRunIds,
  validateProductionRunIds,
  type LockedCreditBatchProductionRun,
} from "./credit-batch-membership";
import { requireOrgScope } from "./utils";

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

  // The caller holds lineage artifacts, the requested runs and the batch.
  // Application writers serialize on those locks before changing allocations.
  // Reconciliation cannot enlarge an assigned slice, so refuse before membership changes.
  const [assignedSlice] = await tx.select({ removalId: creditBatchApplications.removalId })
    .from(applicationOutputAllocations)
    .innerJoin(creditBatchApplications, and(
      eq(creditBatchApplications.applicationId, applicationOutputAllocations.applicationId),
      eq(creditBatchApplications.creditBatchId, creditBatchId),
      eq(creditBatchApplications.organizationId, ctx.organizationId),
    ))
    .where(and(
      inArray(applicationOutputAllocations.productionRunId, addedIds),
      eq(applicationOutputAllocations.organizationId, ctx.organizationId),
      isNotNull(creditBatchApplications.removalId),
    )).limit(1);
  if (!assignedSlice) return;
  const lock = recordLocks.creditBatch({ removals: [], dependents: [{ kind: "removal", id: assignedSlice.removalId! }] });
  throw new DomainError("certification_locked", withRecordLockGuidance(
    "Cannot change this credit batch's production membership because its applied mass belongs to a Removal.", lock));
}
