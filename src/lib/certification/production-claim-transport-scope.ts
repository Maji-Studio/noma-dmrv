import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { collectTransportEntityIds } from "@/lib/isometric";
import { includesProductionInputs } from "./production-claim-policy";

type TransportCategory = "feedstock" | "biochar" | "sample";

type ProductionClaimScopeBatch = {
  id: string;
  productionRunIds: string[];
  productionFeedstockIds: string[];
  productionHasLinkedFeedstock?: boolean;
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
  const productionBatches = args.memberBatches.filter((batch) =>
    batchIncludesProductionInputs(batch, args.removalId),
  );
  return args.requiredTransportCategories.filter((category) => {
    if (category === "biochar") return true;
    return productionBatches.length > 0;
  });
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
  const productionLineages = args.lineages.filter((lineage) =>
    lineage.productionRun
      ? productionRunIds.has(lineage.productionRun.id)
      : false,
  );
  const production = collectTransportEntityIds(productionLineages);
  const feedstockIds = Array.from(
    new Set([
      ...production.feedstockIds,
      ...productionBatches.flatMap((batch) => batch.productionFeedstockIds),
    ]),
  );
  const hasLinkedFeedstock = productionLineages.some(lineage => lineage.feedstocks.length > 0)
    || productionBatches.some(batch => batch.productionHasLinkedFeedstock);
  return {
    feedstockIds,
    ...(hasLinkedFeedstock && feedstockIds.length === 0 ? { feedstockTransportOwnedElsewhere: true } : {}),
    biocharProductIds: all.biocharProductIds,
    sampleIds: production.sampleIds,
  };
}
