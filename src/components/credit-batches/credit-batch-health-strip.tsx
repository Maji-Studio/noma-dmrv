/**
 * CreditBatchHealthStrip — the batch's certification checklist (the submission
 * gate, in plain clothes). Same `useBatchHealth` classifier as the New-Removal
 * wizard's gate (the two can never disagree).
 *
 * The checklist only DETAILS the checks that still need work: each open check
 * is an action row stating the gap (problem-phrased headline + the missing
 * items) with a single button that lands where the gap is actually resolved.
 * Cleared and not-yet-evaluable checks collapse into one compact summary line,
 * so the full four-check picture stays visible without four equal-weight
 * boxes. A `skipped` transport check is a facility-setup concern — it links to
 * certification settings and never counts as a batch issue.
 */
"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CircleIcon,
  ShieldCheckIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { InfoHint } from "@/components/ui/tooltip";
import { useBatchHealth } from "@/hooks/use-certification";
import type { BatchHealth, BatchHealthCheck } from "@/lib/certification/batch-health";
import {
  batchHealthFixLinkFor,
  skippedBatchHealthFixLink,
} from "@/lib/certification/batch-health-links";
import { cn } from "@/lib/utils";

/** Stagger between open-row entrance reveals (ms). */
const ROW_STAGGER_MS = 60;

/**
 * One open (unmet) check: problem headline, the missing items inline, and the
 * single action that resolves it. Replaces both the old check chip and the
 * duplicated "Clear this gate" panel — every open check is self-contained.
 */
function OpenCheckRow({
  check,
  facilityId,
  index,
}: {
  check: BatchHealthCheck;
  facilityId: string;
  index: number;
}) {
  const fix = batchHealthFixLinkFor(check, facilityId);
  const isCrossPage = fix.href.startsWith("/");

  return (
    <li
      className="animate-gate-row flex flex-col gap-12 border-l-2 border-[var(--st-wait)] bg-[var(--st-wait-bg)] px-16 py-12 sm:flex-row sm:items-center sm:justify-between sm:gap-16"
      style={{ animationDelay: `${index * ROW_STAGGER_MS}ms` }}
    >
      <div className="flex items-start gap-10">
        <WarningIcon
          size={16}
          weight="fill"
          className="mt-1 shrink-0 text-[var(--st-wait)]"
        />
        <div className="flex min-w-0 flex-col gap-2">
          {/* The one plain-language requirement string — identical to the
              removal wizard's gap row (Phase 0). Neutral, so it reads correctly
              next to this warning icon without saying "…complete". The raw
              protocol reasoning is tucked behind the ⓘ "Why?" (Phase 1). */}
          <span className="inline-flex items-center gap-6 body-medium font-medium text-[var(--color-text-primary)]">
            {check.requirementLabel}
            {check.whyDetail && (
              <InfoHint label="Why is this required?">{check.whyDetail}</InfoHint>
            )}
          </span>
          {check.detail && (
            <span className="body-caption text-[var(--color-text-secondary)]">
              {check.detail}
            </span>
          )}
        </div>
      </div>
      <Link
        href={fix.href}
        className={cn(
          buttonVariants({ variant: "default", size: "small" }),
          "shrink-0 self-start sm:self-center"
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

/**
 * Compact one-line account of the checks that don't need attention: met checks
 * (affirmative label, green tick) and skipped ones (neutral, with the
 * facility-setup link). Keeps the full picture visible without detailing it.
 */
function ClearedSummary({
  met,
  skipped,
  facilityId,
}: {
  met: BatchHealthCheck[];
  skipped: BatchHealthCheck[];
  facilityId: string;
}) {
  if (met.length === 0 && skipped.length === 0) {
    return null;
  }
  const skippedFix = skippedBatchHealthFixLink(facilityId);

  return (
    <div className="flex flex-wrap items-center gap-x-16 gap-y-8 border-t border-[var(--color-border-tertiary)] pt-12">
      {met.map((check) => (
        <span
          key={check.key}
          className="inline-flex items-center gap-6 body-caption text-[var(--color-text-tertiary)]"
        >
          <CheckCircleIcon
            size={14}
            weight="fill"
            className="shrink-0 text-[var(--st-ok)]"
          />
          {check.requirementLabel}
        </span>
      ))}
      {skipped.map((check) => (
        <span
          key={check.key}
          className="inline-flex items-center gap-6 body-caption text-[var(--color-text-tertiary)]"
        >
          <CircleIcon
            size={14}
            className="shrink-0 text-[var(--color-text-quaternary)]"
          />
          {check.requirementLabel}
          <Link
            href={skippedFix.href}
            className="inline-flex items-center gap-4 font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
          >
            {skippedFix.label}
            <ArrowSquareOutIcon size={12} aria-hidden />
          </Link>
        </span>
      ))}
    </div>
  );
}

/** Right-aligned header status: cleared-count context + a state badge. */
function GateStatus({ health }: { health: BatchHealth }) {
  if (health.state === "ready") {
    return (
      <StatusBadge
        status="ready"
        label="Ready to certify"
        icon={<CheckCircleIcon size={14} weight="fill" />}
      />
    );
  }
  const clearedCount = health.checks.filter((c) => c.status === "met").length;
  return (
    <div className="flex items-center gap-10">
      <span className="label-micro text-[var(--color-text-tertiary)]">
        {clearedCount} of {health.checks.length} cleared
      </span>
      <StatusBadge
        status="pending"
        label={`${health.issueCount} ${health.issueCount === 1 ? "issue" : "issues"} open`}
        icon={<WarningIcon size={14} weight="fill" />}
      />
    </div>
  );
}

function GateBody({
  health,
  facilityId,
}: {
  health: BatchHealth;
  facilityId: string;
}) {
  const open = health.checks.filter((c) => c.status === "unmet");
  const met = health.checks.filter((c) => c.status === "met");
  const skipped = health.checks.filter((c) => c.status === "skipped");

  if (health.state === "ready") {
    return (
      <div className="flex flex-col gap-16">
        <div className="flex items-center gap-12 border border-[var(--st-ok-border)] bg-[var(--st-ok-bg)] px-16 py-12">
          <ShieldCheckIcon
            size={20}
            weight="fill"
            className="shrink-0 text-[var(--st-ok)]"
          />
          <p className="body-small text-[var(--color-text-secondary)]">
            <span className="font-medium text-[var(--color-text-primary)]">
              All checks passed.
            </span>{" "}
            This batch has everything it needs to be submitted for
            certification.
          </p>
        </div>
        <ClearedSummary met={met} skipped={skipped} facilityId={facilityId} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-16">
      <ul className="flex flex-col gap-10">
        {open.map((check, index) => (
          <OpenCheckRow
            key={check.key}
            check={check}
            facilityId={facilityId}
            index={index}
          />
        ))}
      </ul>
      <ClearedSummary met={met} skipped={skipped} facilityId={facilityId} />
    </div>
  );
}

export function CreditBatchHealthStrip({
  creditBatchId,
  facilityId,
}: {
  creditBatchId: string;
  facilityId: string;
}) {
  const { data: health, isLoading, error } = useBatchHealth(creditBatchId);
  const hasOpenIssues = !!health && health.state !== "ready";

  return (
    <section
      className="flex flex-col gap-20 bg-[var(--panel-bg)] [border:var(--panel-border)] p-24"
      data-testid="batch-health-strip"
    >
      <div className="flex flex-col gap-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex max-w-[680px] flex-col gap-4">
          <h2 className="title-heading-3 text-[var(--color-text-primary)]">
            Certification checklist
          </h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            {hasOpenIssues
              ? "Fix the items below before this batch can be submitted for certification."
              : "Everything this batch needs before it can be submitted for certification."}
          </p>
        </div>
        {health && <GateStatus health={health} />}
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
        <GateBody health={health} facilityId={facilityId} />
      )}
    </section>
  );
}
