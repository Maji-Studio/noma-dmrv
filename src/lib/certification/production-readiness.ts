import type { BlockerCopy } from "./removal-template-blockers";

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
  copy?: BlockerCopy;
  fixTarget: ProductionReadinessFixTarget;
}

export function missingApplicationLineageGap(args: {
  hasCompletedMemberProductionRuns: boolean;
  scope: "creditBatch" | "removal";
}): ProductionReadinessGap {
  const subject =
    args.scope === "removal" ? "this Removal" : "this credit batch";
  if (!args.hasCompletedMemberProductionRuns) {
    const copy = { detail: `No completed production runs are linked to ${subject}.`, instruction: "Complete a matching production run to continue." };
    return {
      kind: "noProductionRuns",
      detail: [copy.detail, copy.instruction].join(" "),
      copy,
      fixTarget: "productionRuns",
    };
  }
  const copy = { detail: `Some completed production runs linked to ${subject} have no application.`, instruction: "Review the product, delivery, and application chain." };
  return {
    kind: "noApplications",
    detail: [copy.detail, copy.instruction].join(" "),
    copy,
    fixTarget: "applications",
  };
}

const DEFAULT_NO_PRODUCTION_COPY = { detail: "No production data is linked.", instruction: "Link a production run before submitting." };
export const DEFAULT_NO_PRODUCTION_DETAIL = [DEFAULT_NO_PRODUCTION_COPY.detail, DEFAULT_NO_PRODUCTION_COPY.instruction].join(" ");

export function defaultProductionReadinessGap(): ProductionReadinessGap {
  return {
    kind: "noProductionRuns",
    detail: DEFAULT_NO_PRODUCTION_DETAIL,
    copy: DEFAULT_NO_PRODUCTION_COPY,
    fixTarget: "productionRuns",
  };
}
