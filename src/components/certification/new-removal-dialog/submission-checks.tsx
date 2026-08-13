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
import { Accordion } from "@/components/ui/accordion";
import { InfoHint } from "@/components/ui/tooltip";
import type { RemovalRequirementCheck } from "@/lib/certification/readiness";
import { certificationSettingsHref } from "@/lib/certification/links";
import { actionableSubmissionChecks } from "./submission-facts";

const CHECKS_ITEM = "submission-checks";
const CHECK_ICON_SIZE = 14;
const ACCORDION_ITEM =
  "rounded-none border-[var(--color-border-secondary)] bg-[var(--color-background-white)]";
const ACCORDION_TRIGGER =
  "bg-[var(--color-background-white)] px-16 py-10 hover:bg-[var(--color-surface-light)]";
/** Readiness details pack several records into one string. */
const DETAIL_SEPARATOR = " · ";

interface SubmissionChecksProps {
  checks: RemovalRequirementCheck[];
  facilityId: string;
}

function fixLinksFor(
  check: Pick<RemovalRequirementCheck, "key" | "fixTarget">,
  facilityId: string,
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

  switch (check.key) {
    case "mapping":
    case "template":
      return [
        { label: "Open settings", href: certificationSettingsHref(facilityId) },
      ];
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
      return [
        { label: "Open deliveries", href: `/deliveries?facility=${facilityId}` },
      ];
    case "durability":
      return [
        { label: "Review Samples", href: `/samples?facility=${facilityId}` },
      ];
    default:
      return [];
  }
}

function checkHeading(check: RemovalRequirementCheck): string {
  return check.key === "measurementDates"
    ? "Future dates"
    : check.requirementLabel;
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
}: {
  check: RemovalRequirementCheck;
  facilityId: string;
}) {
  const fixes = fixLinksFor(check, facilityId);
  const detailLines = check.detail?.split(DETAIL_SEPARATOR) ?? [];

  return (
    <li className="flex items-start gap-8 border-t border-[var(--color-border-tertiary)] px-16 py-8 first:border-t-0">
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
          {checkHeading(check)}
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
}: SubmissionChecksProps) {
  const actionChecks = actionableSubmissionChecks(checks);
  const passedCount = actionChecks.filter(
    (check) => check.status === "met",
  ).length;
  const attentionChecks = actionChecks.filter(
    (check) => check.status === "unmet",
  );

  return (
    <Accordion.Root className="gap-0" defaultValue={[CHECKS_ITEM]}>
      <Accordion.Item value={CHECKS_ITEM} className={ACCORDION_ITEM}>
        <Accordion.Header>
          <Accordion.Trigger
            className={ACCORDION_TRIGGER}
            labelClassName="body-small normal-case tracking-normal text-[var(--color-text-primary)]"
          >
            <span className="flex w-full items-center justify-between gap-12">
              <span>What to fix</span>
              <span className="body-caption font-normal text-[var(--color-text-tertiary)]">
                {passedCount} {passedCount === 1 ? "check" : "checks"} passed
              </span>
            </span>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel className="[&>div]:p-0">
          <div className="border-t border-[var(--color-border-tertiary)]">
            <ul>
              {attentionChecks.map((check) => (
                <CheckRow
                  key={check.key}
                  check={check}
                  facilityId={facilityId}
                />
              ))}
            </ul>
          </div>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  );
}
