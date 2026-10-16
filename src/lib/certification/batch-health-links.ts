import type {
  BatchHealthCheck,
  BatchHealthCheckKey,
  BatchHealthFixTarget,
} from "./batch-health";
import {
  buildEntityDeepLink,
  buildFeedstockTypeEditDeepLink,
  ENTITY_FOCUS_TARGETS,
  FEEDSTOCK_TYPE_EDIT_LABEL,
} from "@/lib/entity-deep-link";
import { sampleCreateHref } from "@/lib/sample-create-intent";
import { creditBatchDeepLinkHref, creditBatchRemovalTemplateHref } from "@/lib/credit-batch-links";
import { certificationEmissionEstimatesHref, certificationRemovalTemplatesHref } from "./links";

export interface BatchHealthFixLink {
  label: string;
  href: string;
}

// Note: the problem-phrased "open check headline" was retired in Phase 0 — every
// readiness surface now renders the one neutral `BatchHealthCheck.requirementLabel`
// (see `requirement-labels.ts`), so the batch page and the removal wizard can't
// phrase the same gap differently.

export function fallbackBatchHealthFixTarget(
  key: BatchHealthCheckKey,
): BatchHealthFixTarget {
  switch (key) {
    case "emissions":
      return "emissions";
    case "template":
      return "certificationTemplates";
    case "carbon":
      // Carbon & durability inputs (organic carbon %, H:Corg ratio) are lab
      // sample measurements — they live on the run's samples, NOT the batch
      // form, so the fix must land on Lab Samples.
      return "labSamples";
    case "facilityEmissions":
      return "certificationEmissions";
    case "feedstockTypeMapping":
      return "feedstockTypes";
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
  const locationHref = check.affectedRecords?.[0]?.href;
  if ((target === "deliveryDistances" || target === "feedstocks") && locationHref &&
      check.affectedRecords?.every(record => record.href === locationHref)) {
    return { label: "Edit location distances", href: locationHref };
  }
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
    case "emissions":
      return { label: "Review emissions", href: creditBatchId ? creditBatchDeepLinkHref(creditBatchId, facilityId) : `/credit-batches?${query(undefined, false)}` };
    case "certificationTemplates":
      return { label: "Review Removal templates", href: certificationRemovalTemplatesHref(facilityId) };
    case "creditBatchTemplate":
      return creditBatchId
        ? { label: "Switch template", href: creditBatchRemovalTemplateHref(creditBatchId, facilityId) }
        : { label: "Review credit batches", href: `/credit-batches?${query(undefined, false)}` };
    case "templateLineReview":
      return { label: "Review template lines", href: certificationRemovalTemplatesHref(facilityId) };
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
    case "feedstockTypes": {
      const feedstockTypeId = affectedIds[0];
      return {
        label: FEEDSTOCK_TYPE_EDIT_LABEL,
        href: buildFeedstockTypeEditDeepLink(facilityId, feedstockTypeId),
      };
    }
    case "orders":
      return {
        label: "Review orders",
        href: `/orders?${query(undefined, false)}`,
      };
    case "deliveryEvidence":
      if (affectedCount === 1) return {
        label: `Review ${check.affectedRecords![0].code} evidence`,
        href: buildEntityDeepLink({
          path: "/deliveries", facilityId, entityQueryKey: "delivery",
          entityId: affectedIds[0], focus: ENTITY_FOCUS_TARGETS.transportEvidence,
        }),
      };
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
