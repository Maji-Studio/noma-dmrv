/**
 * CreditBatchHealthStrip — the batch's certification checklist (the submission
 * gate, in plain clothes). Same `useBatchHealth` classifier as the New-Removal
 * wizard's gate (the two can never disagree).
 *
 * The checklist only DETAILS the checks that still need work: each open check
 * is an action row stating the requirement and missing items, with a single
 * button that lands where the gap is actually resolved.
 * A `skipped` transport check is a facility-setup concern and never counts as
 * a batch issue.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  ArrowSquareOutIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, buttonVariants } from "@/components/ui/button";
import { SectionLabel } from "@/components/forms";
import { InfoHint, Tooltip } from "@/components/ui/tooltip";
import { useBatchHealth } from "@/hooks/use-certification";
import type { BatchHealth, BatchHealthCheck } from "@/lib/certification/batch-health";
import type { CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import { formatDate, formatTonnes } from "@/lib/format-utils";
import {
  batchHealthFixLinkFor,
  compactBatchHealthDetail,
} from "@/lib/certification/batch-health-links";
import { CREDIT_BATCH_READY_LABEL } from "@/lib/certification/credit-batch-lifecycle";
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
        const tooltip = (
          <span className="flex flex-col gap-3">
            {run && <span>{formatDate(run.date)}</span>}
            {run && feedstockName && <span>{feedstockName}</span>}
            {run?.biocharDryMassKg != null && (
              <span>{formatTonnes(run.biocharDryMassKg / 1000)} dry output</span>
            )}
            <span>Missing: {record.missing.join(", ")}</span>
          </span>
        );
        return (
          <Tooltip key={record.id} content={tooltip}>
            <button
              type="button"
              className="inline-flex h-28 items-center border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-8 body-caption text-[var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
              aria-label={`${record.code}: ${record.missing.join(", ")}`}
            >
              {record.code}
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
 * One open (unmet) check: problem headline, the missing items inline, and the
 * single action that resolves it. Replaces both the old check chip and the
 * duplicated "Clear this gate" panel — every open check is self-contained.
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
  const open = health.checks.filter((c) => c.status === "unmet");

  if (health.state === "ready") {
    return (
      <div className="flex items-center gap-12 border border-[var(--st-ok-border)] bg-[var(--st-ok-bg)] px-16 py-12">
        <ShieldCheckIcon
          size={20}
          weight="fill"
          className="shrink-0 text-[var(--st-ok)]"
        />
        <p className="body-small font-medium text-[var(--color-text-primary)]">
          All checks passed.
        </p>
      </div>
    );
  }

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
        {health && (
          <span className="shrink-0 body-caption font-medium text-[var(--color-text-secondary)]">
            {health.state === "ready"
              ? CREDIT_BATCH_READY_LABEL
              : `${health.issueCount} ${
                  health.issueCount === 1 ? "issue" : "issues"
                } open`}
          </span>
        )}
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
          {error?.message ?? "Couldn't evaluate this batch's health."}
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
