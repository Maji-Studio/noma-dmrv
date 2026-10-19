/**
 * SubmissionChecks — the readiness checks that still need attention, in a
 * disclosure that is open by default.
 *
 * The caller decides whether this renders at all: when every check passes the
 * verdict line in `submission-summary.tsx` carries the count and this list is
 * not shown. Warning-status checks describe automatic submit-time work, not
 * operator work, so they never appear here (see `actionableSubmissionChecks`).
 */
import Link from "next/link";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { InfoHint } from "@/components/ui/tooltip";
import { ENTITY_READINESS_CHECK_DISPLAY_LIMIT, type RemovalRequirementCheck } from "@/lib/certification/readiness";
import { batchHealthFixLinkFor } from "@/lib/certification/batch-health-links";
import { certCheckLabel } from "@/lib/certification/requirement-labels";
import { transportRepairDestination } from "@/lib/isometric/semantic-binding-catalog";
import { certificationSettingsHref } from "@/lib/certification/links";
import {
  removalTemplateBlockerDestination,
  type RemovalTemplateBlockerCode,
} from "@/lib/certification/removal-template-blockers";
import {
  buildFeedstockTypeEditDeepLink,
  FEEDSTOCK_TYPE_EDIT_LABEL,
} from "@/lib/entity-deep-link";
import { actionableSubmissionChecks } from "./submission-facts";

const CHECK_ICON_SIZE = 14;
/** Readiness details pack several records into one string. */
const DETAIL_SEPARATOR = " · ";

/** A member credit batch, for links that land on its Removal template. */
interface CheckCreditBatch {
  id: string;
  code: string;
}

interface SubmissionChecksProps {
  checks: RemovalRequirementCheck[];
  facilityId: string;
  /** The Removal's credit batches. Template pin blockers link to each one. */
  creditBatches?: readonly CheckCreditBatch[];
}

/**
 * A pin blocker is fixed on each credit batch (Switch template); a line blocker
 * in the template line review. Without codes, fall back to Settings.
 */
function templateFixLinks(
  codes: readonly RemovalTemplateBlockerCode[],
  facilityId: string,
  creditBatches: readonly CheckCreditBatch[],
): { label: string; href: string }[] {
  const destinations = new Set(
    codes.map(removalTemplateBlockerDestination),
  );
  if (destinations.size === 0) {
    return [{ label: "Open settings", href: certificationSettingsHref(facilityId) }];
  }
  const links: { label: string; href: string }[] = [];
  if (destinations.has("creditBatchTemplate")) {
    const target = { key: "template", fixTarget: "creditBatchTemplate" } as const;
    if (creditBatches.length === 0) links.push(batchHealthFixLinkFor(target, facilityId));
    for (const batch of creditBatches) {
      const link = batchHealthFixLinkFor(target, facilityId, batch.id);
      links.push(creditBatches.length === 1 ? link : { ...link, label: `${link.label} on ${batch.code}` });
    }
  }
  if (destinations.has("templateLineReview")) {
    links.push(batchHealthFixLinkFor({ key: "template", fixTarget: "templateLineReview" }, facilityId));
  }
  return links;
}

function fixLinksFor(
  check: Pick<
    RemovalRequirementCheck,
    "key" | "fixTarget" | "fixTargetId" | "transportCategory" | "lineageIssues" | "templateBlockerCodes"
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
    href: `/samples?facility=${facilityId}`,
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
        { label: "Open settings", href: certificationSettingsHref(facilityId) },
      ];
    case "template":
      return templateFixLinks(check.templateBlockerCodes ?? [], facilityId, creditBatches);
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
        { label: "Review Samples", href: `/samples?facility=${facilityId}` },
      ];
    case "feedstockTypeMapping": {
      return [
        {
          label: FEEDSTOCK_TYPE_EDIT_LABEL,
          href: buildFeedstockTypeEditDeepLink(
            facilityId,
            check.fixTargetId,
          ),
        },
      ];
    }
    default:
      return [];
  }
}

function dateGuidance(dateCount: number): string {
  if (dateCount === 1) {
    return "Correct this date, or wait until it has passed.";
  }
  if (dateCount === 2) {
    return "Correct these dates, or wait until both dates have passed.";
  }
  return `Correct these dates, or wait until all ${dateCount} dates have passed.`;
}

/** One unmet check per row: what is wrong, on which record, and where to fix it. */
function CheckRow({
  check,
  facilityId,
  creditBatches,
}: {
  check: RemovalRequirementCheck;
  facilityId: string;
  creditBatches?: readonly CheckCreditBatch[];
}) {
  const fixes = fixLinksFor(check, facilityId, creditBatches);
  const detailLines = check.detail?.split(DETAIL_SEPARATOR) ?? [];

  return (
    <li className="flex items-start gap-8">
      <span className="mt-2">
        <WarningIcon
          size={CHECK_ICON_SIZE}
          weight="fill"
          aria-hidden
          className="shrink-0 text-[var(--st-bad)]"
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="inline-flex items-center gap-4 body-caption text-[var(--color-text-secondary)]">
          {certCheckLabel(check)}
          {check.whyDetail && (
            <InfoHint label="Why is this required?">{check.whyDetail}</InfoHint>
          )}
        </span>
        {detailLines.length === 1 && (
          <span className="body-caption text-[var(--color-text-primary)]">
            {detailLines[0]}
          </span>
        )}
        {detailLines.length > 1 && (
          <ul className="list-disc pl-16 body-caption text-[var(--color-text-primary)]">
            {detailLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {check.key === "measurementDates" && detailLines.length > 0 && (
          <span className="body-caption font-medium text-[var(--color-text-primary)]">
            {dateGuidance(detailLines.length)}
          </span>
        )}
        {fixes.length > 0 && (
          <span className="flex flex-wrap gap-x-12 gap-y-4">
            {fixes.map((fix) => (
              <Link
                key={fix.href}
                href={fix.href}
                className="body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
              >
                {fix.label}
              </Link>
            ))}
          </span>
        )}
      </div>
    </li>
  );
}

export function SubmissionChecks({
  checks,
  facilityId,
  creditBatches,
}: SubmissionChecksProps) {
  const actionChecks = actionableSubmissionChecks(checks);
  const passedCount = actionChecks.filter(
    (check) => check.status === "met",
  ).length;
  const attentionChecks = actionChecks.filter(
    (check) => check.status === "unmet",
  );

  return (
    <section className="flex flex-col gap-12" aria-label="What to fix">
      <div className="flex items-baseline justify-between gap-12">
        <h3 className="body-small font-medium text-[var(--color-text-primary)]">
          What to fix
        </h3>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {passedCount} {passedCount === 1 ? "check" : "checks"} passed
        </span>
      </div>
      <ul className="flex flex-col gap-12">
        {attentionChecks.map((check) => (
          <CheckRow key={`${check.key}-${check.transportCategory ?? ""}`} check={check} facilityId={facilityId} creditBatches={creditBatches} />
        ))}
      </ul>
    </section>
  );
}
