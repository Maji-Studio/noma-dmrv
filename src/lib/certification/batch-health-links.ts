import type {
  BatchHealthCheck,
  BatchHealthCheckKey,
  BatchHealthFixTarget,
} from "./batch-health";
import { certificationSettingsHref } from "./links";

export interface BatchHealthFixLink {
  label: string;
  href: string;
}

export const NEXT_ACTION_DETAIL_MAX_CHARS = 180;

// Note: the problem-phrased "open check headline" was retired in Phase 0 — every
// readiness surface now renders the one neutral `BatchHealthCheck.requirementLabel`
// (see `requirement-labels.ts`), so the batch page and the removal wizard can't
// phrase the same gap differently.

export function compactBatchHealthDetail(
  detail: string,
  maxChars: number = NEXT_ACTION_DETAIL_MAX_CHARS,
): string {
  if (detail.length <= maxChars) {
    return detail;
  }
  return `${detail.slice(0, maxChars).trimEnd()}…`;
}

export function fallbackBatchHealthFixTarget(
  key: BatchHealthCheckKey,
): BatchHealthFixTarget {
  switch (key) {
    case "carbon":
      // Carbon & durability inputs (organic carbon %, H:Corg ratio) are lab
      // sample measurements — they live on the run's samples, NOT the batch
      // form, so the fix must land on Lab Samples.
      return "labSamples";
    case "production":
      return "productionRuns";
    case "transport":
      return "deliveryDistances";
    case "entityReadiness":
      return "sourceData";
  }
}

export function batchHealthFixLinkFor(
  // Only the key + explicit fixTarget drive the link — narrower than the full
  // check so callers (and tests) needn't construct unrelated fields.
  check: Pick<BatchHealthCheck, "key" | "fixTarget">,
  facilityId: string,
): BatchHealthFixLink {
  const target = check.fixTarget ?? fallbackBatchHealthFixTarget(check.key);
  switch (target) {
    case "batchDetails":
      return {
        label: "Edit details",
        href: "#batch-details",
      };
    case "labSamples":
      return {
        label: "Add lab sample data",
        href: `/samples?facility=${facilityId}`,
      };
    case "applications":
      // Applications auto-match by crediting period — there is no manual "link"
      // action. Send the operator to where applications are recorded/verified.
      return {
        label: "Review applications",
        href: `/applications?facility=${facilityId}`,
      };
    case "productionRuns":
      return {
        label: "Link production data",
        href: `/production-runs?facility=${facilityId}`,
      };
    case "biocharProducts":
      return {
        label: "Link production run",
        href: `/biochar-products?facility=${facilityId}`,
      };
    case "deliveries":
    case "deliveryDistances":
      return {
        label: "Review deliveries",
        href: `/deliveries?facility=${facilityId}`,
      };
    case "sourceData":
      return {
        label: "Review source data",
        href: `/production-runs?facility=${facilityId}`,
      };
  }
}

export function skippedBatchHealthFixLink(
  facilityId: string,
): BatchHealthFixLink {
  return {
    label: "Finish facility setup",
    href: certificationSettingsHref(facilityId),
  };
}
