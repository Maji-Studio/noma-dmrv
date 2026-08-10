export type ProductionReadinessFixTarget =
  | "batchDetails"
  | "deliveries"
  | "biocharProducts"
  | "productionRuns"
  | "applications";

export type ProductionReadinessGapKind =
  | "noApplications"
  | "missingBiocharProduct"
  | "biocharProductMissingRun"
  | "productionRunMissing"
  | "noProductionRuns";

export interface ProductionReadinessGap {
  kind: ProductionReadinessGapKind;
  detail: string;
  fixTarget: ProductionReadinessFixTarget;
}

export function missingApplicationLineageGap(args: {
  hasCompletedMemberProductionRuns: boolean;
  scope: "creditBatch" | "removal";
}): ProductionReadinessGap {
  const subject =
    args.scope === "removal" ? "this Removal" : "this credit batch";
  if (!args.hasCompletedMemberProductionRuns) {
    return {
      kind: "noProductionRuns",
      detail: `No completed production runs are linked to ${subject}. Complete a matching production run to continue.`,
      fixTarget: "productionRuns",
    };
  }
  return {
    kind: "noApplications",
    detail: `Some completed production runs linked to ${subject} have no application. Review the product, delivery, and application chain.`,
    fixTarget: "applications",
  };
}

export const DEFAULT_NO_PRODUCTION_DETAIL =
  "No production data is linked. Link a production run before submitting.";

export function defaultProductionReadinessGap(): ProductionReadinessGap {
  return {
    kind: "noProductionRuns",
    detail: DEFAULT_NO_PRODUCTION_DETAIL,
    fixTarget: "productionRuns",
  };
}
