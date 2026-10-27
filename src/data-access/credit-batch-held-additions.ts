import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
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
}
