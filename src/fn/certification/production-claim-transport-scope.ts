import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { collectTransportEntityIds } from "@/lib/isometric";
import { includesProductionInputs } from "./production-claim-policy";

type TransportCategory = "feedstock" | "biochar" | "sample";

type ProductionClaimScopeBatch = {
  id: string;
  productionRunIds: string[];
  productionFeedstockIds: string[];
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
}): ReturnType<typeof collectTransportEntityIds> {
  const productionBatches = args.memberBatches.filter((batch) =>
    batchIncludesProductionInputs(batch, args.removalId),
  );
  const productionRunIds = new Set(
    productionBatches.flatMap((batch) => batch.productionRunIds),
  );
  const all = collectTransportEntityIds(args.lineages);
  const production = collectTransportEntityIds(
    args.lineages.filter((lineage) =>
      lineage.productionRun
        ? productionRunIds.has(lineage.productionRun.id)
        : false,
    ),
  );
  return {
    feedstockIds: Array.from(
      new Set([
        ...production.feedstockIds,
        ...productionBatches.flatMap((batch) => batch.productionFeedstockIds),
      ]),
    ),
    biocharProductIds: all.biocharProductIds,
    sampleIds: production.sampleIds,
  };
}
