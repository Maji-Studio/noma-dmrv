import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import {
  defaultProductionReadinessGap,
  type ProductionReadinessGap,
} from "@/lib/certification/production-readiness";

export function productionReadinessGapFromLineages(
  lineages: ChainOfCustodyData[],
): ProductionReadinessGap | null {
  if (lineages.every((lineage) => lineage.productionRun)) return null;

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
      lineage.biocharProduct && !lineage.biocharProduct.linkedProductionRunId,
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
