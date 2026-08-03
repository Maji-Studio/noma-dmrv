/**
 * CreditBatchHealthStrip — the batch's certification checklist (the submission
 * gate, in plain clothes). Same `useBatchHealth` classifier as the New-Removal
 * wizard's gate (the two can never disagree).
 *
 * The checklist only DETAILS the checks that still need work: each open check
 * states the requirement and missing items. Most rows include a button that
 * lands where the gap is resolved; lab-sample actions live in the Lab Samples
 * panel immediately below instead of being duplicated here.
 * A `skipped` transport check is a facility-setup concern and never counts as
 * a batch issue.
 *
 * A passing batch states that ONCE, in the header — the lifecycle rail above
 * already carries the milestone label ("Batch data ready"), so the section no
 * longer repeats it as a right-hand status AND a green confirmation panel.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, buttonVariants } from "@/components/ui/button";
import { SectionLabel } from "@/components/forms";
import { InfoHint, Tooltip } from "@/components/ui/tooltip";
import { useBatchHealth } from "@/hooks/use-certification";
import type { BatchHealth, BatchHealthCheck } from "@/lib/certification/batch-health";
import type { CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import { formatDate } from "@/lib/format-utils";
import { formatWetDryMass } from "@/lib/mass-moisture";
import {
  batchHealthFixLinkFor,
  compactBatchHealthDetail,
  resolveBatchHealthFixTarget,
} from "@/lib/certification/batch-health-links";
import { cn } from "@/lib/utils";

/** Stagger between open-row entrance reveals (ms). */
const ROW_STAGGER_MS = 60;
const AFFECTED_RECORD_PREVIEW_LIMIT = 4;
const OPEN_CHECK_DETAIL_MAX_CHARS = 120;

function AffectedRecordChips({
  check,
  productionRuns,
  feedstockName,
}: {
  check: BatchHealthCheck;
  productionRuns: CreditBatchProductionRunOption[];
  feedstockName?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const records = check.affectedRecords ?? [];
  if (records.length === 0) return null;
  const visibleRecords = expanded
    ? records
    : records.slice(0, AFFECTED_RECORD_PREVIEW_LIMIT);
  const hiddenCount = records.length - visibleRecords.length;

  return (
    <div className="flex flex-wrap items-center gap-6 pt-4">
      {visibleRecords.map((record) => {
        const run = productionRuns.find((candidate) => candidate.id === record.id);
        const isProductionRunRecord =
          check.fixTarget === "productionRuns" ||
          check.fixTarget === "sourceData";
        const recordLabel = run
          ? run.biocharStorageName ?? formatDate(run.date)
          : isProductionRunRecord
            ? "Affected production run"
            : record.code;
        const tooltip = (
          <span className="flex flex-col gap-4">
            {run && <span>{formatDate(run.date)}</span>}
            {run && feedstockName && <span>{feedstockName}</span>}
            {run &&
              (run.biocharOutputKg != null ||
                run.biocharDryMassKg != null) && (
              <span>
                Biochar output:{" "}
                {formatWetDryMass({
                  wetKg: run.biocharOutputKg,
                  dryKg: run.biocharDryMassKg,
                })}
              </span>
            )}
            <span>Missing: {record.missing.join(", ")}</span>
          </span>
        );
        return (
          <Tooltip key={record.id} content={tooltip}>
            <button
              type="button"
              className="inline-flex h-28 items-center border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-8 body-caption text-[var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              aria-label={`${recordLabel}: ${record.missing.join(", ")}`}
            >
              {recordLabel}
            </button>
          </Tooltip>
        );
      })}
      {!expanded && hiddenCount > 0 && (
        <Button
          variant="noOutline"
          size="small"
          className="h-28 px-6 body-caption"
          onClick={() => setExpanded(true)}
        >
          +{hiddenCount} affected
        </Button>
      )}
      {expanded && records.length > AFFECTED_RECORD_PREVIEW_LIMIT && (
        <Button
          variant="noOutline"
          size="small"
          className="h-28 px-6 body-caption"
          onClick={() => setExpanded(false)}
        >
          Show fewer
        </Button>
      )}
    </div>
  );
}

/**
 * One open (unmet) check: problem headline, the missing items inline, and an
 * action when it is not already provided by the following detail panel.
 */
function OpenCheckRow({
  check,
  facilityId,
  creditBatchId,
  index,
  productionRuns,
  feedstockName,
}: {
  check: BatchHealthCheck;
  facilityId: string;
  creditBatchId: string;
  index: number;
  productionRuns: CreditBatchProductionRunOption[];
  feedstockName?: string | null;
}) {
  const fix = batchHealthFixLinkFor(check, facilityId, creditBatchId);
  const fixTarget = resolveBatchHealthFixTarget(check);
  const actionOwnedByLabSamplesPanel = fixTarget === "labSamples";
  const isCrossPage = fix.href.startsWith("/");

  return (
    <li
      className="animate-gate-row flex flex-col gap-12 border-l-2 border-[var(--color-border-secondary)] bg-[var(--sea)] px-16 py-12"
      style={{ animationDelay: `${index * ROW_STAGGER_MS}ms` }}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {/* The one plain-language requirement string — identical to the
            removal wizard's gap row (Phase 0). The protocol reasoning is
            tucked behind the "Why?" hint (Phase 1). */}
        <span className="inline-flex items-center gap-6 body-medium font-medium text-[var(--color-text-primary)]">
          {check.requirementLabel}
          {check.whyDetail && (
            <InfoHint label="Why is this required?">{check.whyDetail}</InfoHint>
          )}
        </span>
        {check.detail && (
          <span className="body-caption text-[var(--color-text-secondary)]">
            {compactBatchHealthDetail(
              check.detail.replace(/^Missing:\s*/i, ""),
              OPEN_CHECK_DETAIL_MAX_CHARS,
            )}
          </span>
        )}
        <AffectedRecordChips
          check={check}
          productionRuns={productionRuns}
          feedstockName={feedstockName}
        />
      </div>
      {!actionOwnedByLabSamplesPanel && (
        <Link
          href={fix.href}
          className={cn(
            buttonVariants({ variant: "default", size: "small" }),
            "shrink-0 self-start",
          )}
        >
          {fix.label}
          {isCrossPage ? (
            <ArrowSquareOutIcon size={14} aria-hidden />
          ) : (
            <ArrowRightIcon size={14} aria-hidden />
          )}
        </Link>
      )}
    </li>
  );
}

function GateBody({
  health,
  facilityId,
  creditBatchId,
  productionRuns,
  feedstockName,
}: {
  health: BatchHealth;
  facilityId: string;
  creditBatchId: string;
  productionRuns: CreditBatchProductionRunOption[];
  feedstockName?: string | null;
}) {
  // A ready batch says so once, in the section header — no body at all.
  if (health.state === "ready") return null;

  const open = health.checks.filter((c) => c.status === "unmet");

  return (
    <ul className="flex flex-col gap-10">
      {open.map((check, index) => (
        <OpenCheckRow
          key={`${check.key}:${check.issueKey ?? index}`}
          check={check}
          facilityId={facilityId}
          creditBatchId={creditBatchId}
          index={index}
          productionRuns={productionRuns}
          feedstockName={feedstockName}
        />
      ))}
    </ul>
  );
}

export function CreditBatchHealthStrip({
  creditBatchId,
  facilityId,
  productionRuns = [],
  feedstockName,
}: {
  creditBatchId: string;
  facilityId: string;
  productionRuns?: CreditBatchProductionRunOption[];
  feedstockName?: string | null;
}) {
  const { data: health, isLoading, error } = useBatchHealth(creditBatchId);
  const hasOpenIssues = !!health && health.state !== "ready";

  return (
    <section
      className="flex flex-col gap-16 border-t border-[var(--color-border-tertiary)] pt-16"
      data-testid="batch-health-strip"
    >
      <div className="flex items-start justify-between gap-16">
        <div className="flex max-w-[680px] flex-col gap-4">
          <SectionLabel>Certification requirements</SectionLabel>
          {hasOpenIssues && (
            <p className="body-small text-[var(--color-text-secondary)]">
              Complete these before adding this batch to a Removal.
            </p>
          )}
        </div>
        {health &&
          (health.state === "ready" ? (
            <span className="inline-flex shrink-0 items-center gap-6 body-caption font-medium text-[var(--st-ok)]">
              <CheckCircleIcon size={14} weight="fill" aria-hidden />
              All batch data checks passed
            </span>
          ) : (
            <span className="shrink-0 body-caption font-medium text-[var(--color-text-secondary)]">
              {`${health.issueCount} ${
                health.issueCount === 1 ? "issue" : "issues"
              } open`}
            </span>
          ))}
      </div>

      {isLoading ? (
        <span
          className="body-caption text-[var(--color-text-tertiary)]"
          aria-busy="true"
        >
          Evaluating…
        </span>
      ) : error || !health ? (
        <span className="body-caption text-[var(--st-wait)]">
          {error?.message ??
            "This credit batch's readiness could not be checked. Refresh the page and try again."}
        </span>
      ) : (
        <GateBody
          health={health}
          facilityId={facilityId}
          creditBatchId={creditBatchId}
          productionRuns={productionRuns}
          feedstockName={feedstockName}
        />
      )}
    </section>
  );
}
