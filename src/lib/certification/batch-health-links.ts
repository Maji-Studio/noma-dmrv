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
      return "batchDetails";
    case "production":
      return "productionRuns";
    case "transport":
      return "deliveryDistances";
    case "entityReadiness":
      return "sourceData";
  }
}

export function batchHealthFixLinkFor(
  check: BatchHealthCheck,
  facilityId: string,
): BatchHealthFixLink {
  const target = check.fixTarget ?? fallbackBatchHealthFixTarget(check.key);
  switch (target) {
    case "batchDetails":
      return {
        label:
          check.key === "production" ? "Link applications" : "Edit details",
        href: "#batch-details",
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
