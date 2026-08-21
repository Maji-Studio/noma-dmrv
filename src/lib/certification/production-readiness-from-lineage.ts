import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import {
  defaultProductionReadinessGap,
  missingApplicationLineageGap,
  type ProductionReadinessGap,
} from "@/lib/certification/production-readiness";

function sourceProductionRunIds(lineage: ChainOfCustodyData): string[] {
  return (lineage.sources ?? []).map((source) => source.productionRun.id);
}

export function productionReadinessGapFromLineages(
  lineages: ChainOfCustodyData[],
): ProductionReadinessGap | null {
  if (
    lineages.every(
      (lineage) =>
        lineage.productionRun || sourceProductionRunIds(lineage).length > 0,
    )
  ) {
    return null;
  }

  const missingProduct = lineages.find((lineage) => !lineage.biocharProduct);
  if (missingProduct) {
    return {
      kind: "missingBiocharProduct",
      detail: `Application ${missingProduct.application.code} is not linked to a biochar product through its delivery or order`,
      fixTarget: "deliveries",
    };
  }

  const productMissingRun = lineages.find(
    (lineage) =>
      lineage.biocharProduct &&
      !lineage.biocharProduct.linkedProductionRunId &&
      sourceProductionRunIds(lineage).length === 0,
  );
  if (productMissingRun?.biocharProduct) {
    return {
      kind: "biocharProductMissingRun",
      detail: `Biochar product ${productMissingRun.biocharProduct.code} is not linked to a production run`,
      fixTarget: "biocharProducts",
    };
  }

  const missingRun = lineages.find(
    (lineage) =>
      lineage.biocharProduct?.linkedProductionRunId && !lineage.productionRun,
  );
  if (missingRun?.biocharProduct) {
    return {
      kind: "productionRunMissing",
      detail: `Biochar product ${missingRun.biocharProduct.code} links to a production run that could not be loaded`,
      fixTarget: "biocharProducts",
    };
  }

  return defaultProductionReadinessGap();
}

export function productionReadinessGapForScope(args: {
  lineages: ChainOfCustodyData[];
  completedMemberProductionRunIds: string[];
  scope: "creditBatch" | "removal";
}): ProductionReadinessGap | null {
  const lineageGap = productionReadinessGapFromLineages(args.lineages);
  if (lineageGap) return lineageGap;

  // One valid Application makes the Removal submittable. Other completed
  // member runs may still be unapplied: their whole-batch production inputs
  // are front-loaded now while their stored/delivery mass remains zero.
  if (args.lineages.length > 0) {
    return null;
  }

  return missingApplicationLineageGap({
    hasCompletedMemberProductionRuns:
      args.completedMemberProductionRunIds.length > 0,
    scope: args.scope,
  });
}
