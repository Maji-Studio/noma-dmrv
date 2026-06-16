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

export const DEFAULT_NO_PRODUCTION_DETAIL =
  "No production data linked yet — nothing to submit";

export function defaultProductionReadinessGap(): ProductionReadinessGap {
  return {
    kind: "noProductionRuns",
    detail: DEFAULT_NO_PRODUCTION_DETAIL,
    fixTarget: "productionRuns",
  };
}
