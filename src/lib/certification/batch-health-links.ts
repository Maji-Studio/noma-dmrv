import type {
  BatchHealthCheck,
  BatchHealthCheckKey,
  BatchHealthFixTarget,
} from "./batch-health";
import {
  buildEntityDeepLink,
  ENTITY_FOCUS_TARGETS,
} from "@/lib/entity-deep-link";
import { sampleCreateHref } from "@/lib/sample-create-intent";
import { certificationEmissionEstimatesHref } from "./links";

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
    case "facilityEmissions":
      return "certificationEmissions";
    case "production":
      return "productionRuns";
    case "transport":
      return "deliveryDistances";
    case "entityReadiness":
      return "sourceData";
  }
}

export function resolveBatchHealthFixTarget(
  check: Pick<BatchHealthCheck, "key" | "fixTarget">,
): BatchHealthFixTarget {
  return check.fixTarget ?? fallbackBatchHealthFixTarget(check.key);
}

export function batchHealthFixLinkFor(
  // Only the key + explicit fixTarget drive the link — narrower than the full
  // check so callers (and tests) needn't construct unrelated fields.
  check: Pick<BatchHealthCheck, "key" | "fixTarget" | "affectedRecords">,
  facilityId: string,
  creditBatchId?: string,
): BatchHealthFixLink {
  const target = resolveBatchHealthFixTarget(check);
  const affectedIds = check.affectedRecords?.map((record) => record.id) ?? [];
  const affectedCount = affectedIds.length;
  const query = (
    extra?: Record<string, string>,
    includeAffectedIds = true,
  ) => {
    const params = new URLSearchParams({ facility: facilityId, ...extra });
    if (includeAffectedIds && affectedIds.length > 0) {
      params.set("ids", affectedIds.join(","));
    }
    return params.toString();
  };
  switch (target) {
    case "batchDetails":
      return {
        label: "Edit details",
        href: "#batch-details",
      };
    case "labSamples":
      return {
        label:
          affectedCount > 0
            ? `Fix ${affectedCount} ${affectedCount === 1 ? "Sample" : "Samples"}`
            : "Add Sample data",
        href: creditBatchId
          ? sampleCreateHref(facilityId, creditBatchId)
          : `/samples?${query(undefined, false)}`,
      };
    case "certificationEmissions":
      return {
        label: "Open emission estimates",
        href: certificationEmissionEstimatesHref(facilityId),
      };
    case "applications":
      // Applications auto-match by crediting period — there is no manual "link"
      // action. Send the operator to where applications are recorded/verified.
      return {
        label:
          affectedCount > 0
            ? `Fix ${affectedCount} ${affectedCount === 1 ? "application" : "applications"}`
            : "Review applications",
        href: `/applications?${query(
          creditBatchId ? { creditBatch: creditBatchId } : undefined,
        )}`,
      };
    case "productionRuns":
      return {
        label:
          affectedCount > 0
            ? `Fix ${affectedCount} production ${affectedCount === 1 ? "run" : "runs"}`
            : "Link production data",
        href: `/production-runs?${query(
          creditBatchId ? { creditBatch: creditBatchId } : undefined,
        )}`,
      };
    case "biocharProducts":
      return {
        label: "Link production run",
        href: `/biochar-products?${query(
          creditBatchId ? { creditBatch: creditBatchId } : undefined,
          false,
        )}`,
      };
    case "feedstocks": {
      const feedstockId = affectedIds[0];
      return {
        label: "Review feedstock transport",
        href: feedstockId
          ? buildEntityDeepLink({
              path: "/feedstocks",
              facilityId,
              entityQueryKey: "feedstock",
              entityId: feedstockId,
              focus: ENTITY_FOCUS_TARGETS.transportEvidence,
            })
          : `/feedstocks?facility=${facilityId}`,
      };
    }
    case "deliveries":
    case "deliveryDistances":
      return {
        label: "Review deliveries",
        href: `/deliveries?${query(
          creditBatchId ? { creditBatch: creditBatchId } : undefined,
          false,
        )}`,
      };
    case "sourceData":
      return {
        label: "Review source data",
        href: `/production-runs?${query(
          creditBatchId ? { creditBatch: creditBatchId } : undefined,
          false,
        )}`,
      };
  }
}
