import type { OrgContext } from "@/lib/auth/server";
import { getCertifierRemovalById, getCreditBatchesByRemovalId, type CertifierRemovalRow } from "@/data-access/certifier-removals";
import { projectChainOfCustodyFromBatchFacts, type ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { loadCreditBatchRollups, type BatchLineageRunFact, type CreditBatchRollup } from "@/data-access/credit-batch-accounting";
import { getCreditBatchActiveScopeRemovalId } from "@/data-access/credit-batches";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { SafeError } from "@/lib/errors";
import { collectFeedstockCodes } from "./certify-lineage-blockers";
import { toMemberCreditBatch, type MemberCreditBatch } from "./member-credit-batch";
import { summarizeApplicationSlices } from "./application-slice-summary";

type DurabilityOption = "200_year" | "1000_year";

// The set of credit batches that compose one removal, with their facility.
export interface RemovalScope {
  facilityId: string;
  removalId: string | null;
  removal: CertifierRemovalRow | null;
  memberBatches: (MemberCreditBatch & {
    productionRunIds: string[];
    // Member runs with status "complete" — drives the readiness routing between
    // "complete a run" and "review the application chain" when nothing is
    // submittable. Membership writes already reject non-complete runs and block
    // reopening a member run, so this filter is defensive (legacy rows, future
    // membership paths); it also keeps the routing honest with the gap copy's
    // "completed" claim.
    completedProductionRunIds: string[];
    productionFeedstockIds: string[];
    applicationIds: string[];
    applicationSlices: {
      applicationId: string;
      allocatedWetMassKg: number;
      allocatedDryMassKg: number;
    }[];
    durabilityOption: DurabilityOption;
    // §8.6.2 production-bucket claim state (issue #349, ADR 0020): the removal
    // that already claimed this batch's production emissions, or null.
    productionEmissionsClaimedByRemovalId: string | null;
  })[];
  lineages: ChainOfCustodyData[];
  feedstockCodes: Record<string, string>;
}

function completedRunIds(runs: BatchLineageRunFact[]): string[] {
  return runs
    .filter((run) => run.status === COMPLETED_PRODUCTION_RUN_STATUS)
    .map((run) => run.id);
}

// Resolves the removal scope for a credit batch. When the batch is already
// grouped, the scope is every member of that removal; otherwise it is the
// batch alone (a 1:1 removal that will be created lazily on submit).
export async function resolveScopeForCreditBatch(
  orgCtx: OrgContext,
  creditBatchId: string,
  options?: { singleBatch?: boolean },
): Promise<RemovalScope> {
  if (!options?.singleBatch) {
    const removalId = await getCreditBatchActiveScopeRemovalId(
      orgCtx,
      creditBatchId,
    );
    if (removalId) {
      return resolveScopeForRemoval(orgCtx, removalId);
    }
  }

  const accounting = (
    await loadCreditBatchRollups(orgCtx, [creditBatchId], {
      unassignedOnly: !options?.singleBatch,
    })
  )[creditBatchId];
  if (!options?.singleBatch) {
    const racedRemovalId = await getCreditBatchActiveScopeRemovalId(
      orgCtx,
      creditBatchId,
    );
    if (racedRemovalId) return resolveScopeForRemoval(orgCtx, racedRemovalId);
  }
  if (!accounting) throw new SafeError("Credit batch not found");

  return resolveSingleBatchScope(accounting);
}

export function resolveSingleBatchScope(
  accounting: CreditBatchRollup,
): RemovalScope {
  const { batch, lineageFacts } = accounting;
  const runById = new Map(
    lineageFacts.runs.map((run) => [run.id, run]),
  );
  return {
    facilityId: batch.facilityId,
    removalId: null,
    removal: null,
    feedstockCodes: collectFeedstockCodes(lineageFacts.runs),
    memberBatches: [
      {
        ...toMemberCreditBatch(accounting),
        productionRunIds: lineageFacts.productionRunIds,
        completedProductionRunIds: completedRunIds(lineageFacts.runs),
        productionFeedstockIds: Array.from(
          new Set(
            lineageFacts.runs.flatMap((run) =>
              run.feedstocks.map((feedstock) => feedstock.id),
            ),
          ),
        ),
        applicationIds: lineageFacts.applicationIds,
        applicationSlices: summarizeApplicationSlices(lineageFacts.applications),
        durabilityOption: batch.durabilityOption,
        productionEmissionsClaimedByRemovalId:
          batch.productionEmissionsClaimedByRemovalId,
      },
    ],
    lineages: lineageFacts.applications.map((application) =>
      projectChainOfCustodyFromBatchFacts(
        application,
        runById.get(application.biocharProduct.linkedProductionRunId),
      ),
    ),
  };
}

// Resolves the removal scope from a removal id — every member credit batch.
export async function resolveScopeForRemoval(
  orgCtx: OrgContext,
  removalId: string,
): Promise<RemovalScope> {
  const removal = await getCertifierRemovalById(orgCtx, removalId);
  if (!removal) throw new SafeError("Removal not found");

  const batches = await getCreditBatchesByRemovalId(orgCtx, removalId);
  const batchIds = batches.map((batch) => batch.id);
  const accountingByBatch = await loadCreditBatchRollups(orgCtx, batchIds, {
    removalId,
  });
  const memberBatches = batches.map((batch) => {
      const accounting = accountingByBatch[batch.id];
      if (!accounting) {
        throw new SafeError(`Credit batch ${batch.id} could not be loaded`);
      }
      const { lineageFacts, batch: accountingBatch } = accounting;
      return {
        ...toMemberCreditBatch(accounting),
        productionRunIds: lineageFacts.productionRunIds,
        completedProductionRunIds: completedRunIds(lineageFacts.runs),
        productionFeedstockIds: Array.from(
          new Set(
            lineageFacts.runs.flatMap((run) =>
              run.feedstocks.map((feedstock) => feedstock.id),
            ),
          ),
        ),
        applicationIds: lineageFacts.applicationIds,
        applicationSlices: summarizeApplicationSlices(lineageFacts.applications),
        durabilityOption: accountingBatch.durabilityOption,
        productionEmissionsClaimedByRemovalId:
          accountingBatch.productionEmissionsClaimedByRemovalId,
      };
    });
  const lineages = Object.values(accountingByBatch).flatMap((accounting) => {
    const { lineageFacts } = accounting;
    const runById = new Map(
      lineageFacts.runs.map((run) => [run.id, run]),
    );
    return lineageFacts.applications.map((application) =>
      projectChainOfCustodyFromBatchFacts(
        application,
        runById.get(application.biocharProduct.linkedProductionRunId),
      ),
    );
  });
  return {
    facilityId: removal.facilityId,
    removalId,
    removal,
    memberBatches,
    feedstockCodes: collectFeedstockCodes(
      Object.values(accountingByBatch).flatMap((accounting) => accounting.lineageFacts.runs),
    ),
    lineages: [
      ...new Map(
        lineages.map((lineage) => [
          `${lineage.application.id}:${lineage.biocharProduct?.id ?? "missing"}:${lineage.productionRun?.id ?? "missing"}`,
          lineage,
        ]),
      ).values(),
    ],
  };
}

