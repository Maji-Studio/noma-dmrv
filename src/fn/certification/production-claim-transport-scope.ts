import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import { collectTransportEntityIds } from "@/lib/isometric";
import { includesProductionInputs } from "./production-claim-policy";

type TransportCategory = "feedstock" | "biochar" | "sample";

type ProductionClaimScopeBatch = {
  id: string;
  productionRunIds: string[];
  productionEmissionsClaimedByRemovalId: string | null;
};

function batchIncludesProductionInputs(
  batch: ProductionClaimScopeBatch,
  removalId: string | null,
): boolean {
  return includesProductionInputs(
    batch.productionEmissionsClaimedByRemovalId,
    removalId,
  );
}

/**
 * A later Removal must not be blocked by transport categories that belong only
 * to production inputs already claimed by an earlier Removal. Biochar delivery
 * remains in scope for every application slice.
 */
export function collectProductionClaimAwareRequiredTransportCategories(args: {
  removalId: string | null;
  memberBatches: ProductionClaimScopeBatch[];
  requiredTransportCategories: readonly TransportCategory[];
}): TransportCategory[] {
  const includesProductionInputs = args.memberBatches.some((batch) =>
    batchIncludesProductionInputs(batch, args.removalId),
  );
  return includesProductionInputs
    ? [...args.requiredTransportCategories]
    : args.requiredTransportCategories.filter(
        (category) => category === "biochar",
      );
}

export function collectProductionClaimAwareTransportEntityIds(args: {
  removalId: string | null;
  memberBatches: ProductionClaimScopeBatch[];
  lineages: ChainOfCustodyData[];
  batchesWithSamples: CreditBatchWithSamples[];
}): ReturnType<typeof collectTransportEntityIds> {
  const productionBatches = args.memberBatches.filter((batch) =>
    batchIncludesProductionInputs(batch, args.removalId),
  );
  const productionBatchIds = new Set(
    productionBatches.map((batch) => batch.id),
  );
  const productionRunIds = new Set(
    productionBatches.flatMap((batch) => batch.productionRunIds),
  );
  const all = collectTransportEntityIds(
    args.lineages,
    args.batchesWithSamples,
  );
  const production = collectTransportEntityIds(
    args.lineages.filter((lineage) =>
      lineage.productionRun
        ? productionRunIds.has(lineage.productionRun.id)
        : false,
    ),
    args.batchesWithSamples.filter((batch) =>
      productionBatchIds.has(batch.creditBatchId),
    ),
  );
  return {
    feedstockIds: production.feedstockIds,
    biocharProductIds: all.biocharProductIds,
    sampleIds: production.sampleIds,
  };
}
