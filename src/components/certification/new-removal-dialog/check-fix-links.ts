/**
 * Where each unmet readiness check is repaired: the links Review & submit puts
 * under a fix. Pure data, no rendering; `review-items.ts` turns a check and
 * these links into one fix item.
 */
import { recordHref } from "@/lib/record-links";
import { ENTITY_READINESS_CHECK_DISPLAY_LIMIT, type RemovalRequirementCheck } from "@/lib/certification/readiness";
import { batchHealthFixLinkFor } from "@/lib/certification/batch-health-links";
import { transportRepairDestination } from "@/lib/isometric/semantic-binding-catalog";
import { facilityCertificationSettingsHref } from "@/lib/certification/links";
import type { RemovalBlockerCode } from "@/lib/certification/removal-blockers";
import { templateFixTarget, type TemplateFixTarget } from "@/lib/certification/template-fix-targets";
import { isTemplateRoutedCode } from "@/lib/certification/removal-template-blockers";
import { FEEDSTOCK_TYPE_EDIT_LABEL } from "@/lib/entity-deep-link";

/** A member credit batch, for links that land on its Removal template. */
export interface CheckCreditBatch {
  id: string;
  code: string;
}

function perBatchLinks(
  target: Parameters<typeof batchHealthFixLinkFor>[0],
  facilityId: string,
  creditBatches: readonly CheckCreditBatch[],
): { label: string; href: string }[] {
  if (creditBatches.length === 0) return [batchHealthFixLinkFor(target, facilityId)];
  return creditBatches.map((batch) => {
    const link = batchHealthFixLinkFor(target, facilityId, batch.id);
    return creditBatches.length === 1 ? link : { ...link, label: `${link.label} on ${batch.code}` };
  });
}

/** Keep decision, filling and batch-template repairs distinct. */
function templateFixLinks(
  codes: readonly RemovalBlockerCode[],
  facilityId: string,
  targets?: readonly TemplateFixTarget[],
): { label: string; href: string }[] {
  const destinations = new Set(targets ?? codes.filter(isTemplateRoutedCode).map(templateFixTarget));
  if (destinations.size === 0) {
    return [batchHealthFixLinkFor({ key: "templateLines", fixTarget: "templateLines" }, facilityId)];
  }
  // Both open the same review page. Keep the specific decision action when needed.
  if (destinations.has("templateLineReview")) destinations.delete("templateLines");
  return [...destinations].flatMap((fixTarget) => {
    const target = { key: "templateLines", fixTarget } as const;
    // One facility Removal template now: setup and replacement go to the same Settings dialog for every batch.
    return [batchHealthFixLinkFor(target, facilityId)];
  }).filter((link, index, links) => links.findIndex((item) => item.href === link.href) === index);
}

export function fixLinksFor(
  check: Pick<
    RemovalRequirementCheck,
    "key" | "fixTarget" | "fixTargetId" | "transportCategory" | "lineageIssues" | "templateBlockerCodes" | "templateFixTargets"
  >,
  facilityId: string,
  creditBatches: readonly CheckCreditBatch[] = [],
): { label: string; href: string }[] {
  const productionRuns = {
    label: "Review production runs",
    href: `/production-runs?facility=${facilityId}`,
  };
  const applications = {
    label: "Review applications",
    href: `/applications?facility=${facilityId}`,
  };
  const labSamples = {
    label: "Review Samples",
    href: `/lab-samples?facility=${facilityId}`,
  };

  const links = (check.lineageIssues ?? []).slice(0, ENTITY_READINESS_CHECK_DISPLAY_LIMIT).map((issue) => batchHealthFixLinkFor({
    key: check.key === "transport" ? "transport" : "entityReadiness", fixTarget: issue.fixTarget,
    affectedRecords: [{ ...issue.record, missing: [issue.detail] }],
  }, facilityId));
  const lineageLinks = [...new Map(links.map((link) => [link.href, link])).values()];

  switch (check.key) {
    case "entityReadiness": {
      return lineageLinks;
    }
    case "mapping":
      return [
        { label: "Open settings", href: facilityCertificationSettingsHref(facilityId) },
      ];
    case "templateSet":
    case "templateLines":
      return check.key === "templateSet" && !check.templateBlockerCodes?.length
        ? [{ label: "Open settings", href: facilityCertificationSettingsHref(facilityId) }]
        : templateFixLinks(check.templateBlockerCodes ?? [], facilityId, check.templateFixTargets);
    case "emissions":
      return perBatchLinks({ key: "emissions" }, facilityId, creditBatches);
    case "measurementDates":
      if (check.fixTarget === "productionRuns") return [productionRuns];
      if (check.fixTarget === "labSamples") return [labSamples];
      if (check.fixTarget === "applications") return [applications];
      if (check.fixTarget === "productionRunsAndApplications") {
        return [productionRuns, applications];
      }
      if (check.fixTarget === "productionRunsAndLabSamples") {
        return [productionRuns, labSamples];
      }
      if (check.fixTarget === "applicationsAndLabSamples") {
        return [applications, labSamples];
      }
      if (check.fixTarget === "productionRunsApplicationsAndLabSamples") {
        return [productionRuns, applications, labSamples];
      }
      return [];
    case "transportUniformity":
    case "transport":
      if (lineageLinks.length) return lineageLinks;
      if (!check.transportCategory) return [];
      return [{
        ...batchHealthFixLinkFor({
          key: "transport",
          fixTarget: transportRepairDestination(check.transportCategory),
        }, facilityId),
        label: `Review ${check.transportCategory} transport`,
      }];
    case "durability":
      return [
        { label: "Review Samples", href: `/lab-samples?facility=${facilityId}` },
      ];
    case "feedstockTypeMapping": {
      return [
        {
          label: FEEDSTOCK_TYPE_EDIT_LABEL,
          href: check.fixTargetId ? recordHref("feedstockType", check.fixTargetId, { facilityId, mode: "edit" }) : `/feedstock-types?${new URLSearchParams({ facility: facilityId })}`,
        },
      ];
    }
    default:
      return [];
  }
}

export function dateGuidance(dateCount: number): string {
  if (dateCount === 1) {
    return "Correct this date, or wait until it has passed.";
  }
  if (dateCount === 2) {
    return "Correct these dates, or wait until both dates have passed.";
  }
  return `Correct these dates, or wait until all ${dateCount} dates have passed.`;
}
