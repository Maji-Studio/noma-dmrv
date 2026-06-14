/**
 * CreditBatchHealthStrip — the batch's submission gate. Same `useBatchHealth`
 * classifier as the New-Removal wizard's gate (the two can never disagree);
 * unmet checks point directly to where the record is fixed. A `skipped`
 * transport check is a facility-setup concern — it links to certification
 * settings and never counts as a batch issue.
 */
"use client";

import Link from "next/link";
import {
  ArrowSquareOut,
  CheckCircle,
  Circle,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { buttonVariants } from "@/components/ui/button";
import { useBatchHealth } from "@/hooks/use-certification";
import type { BatchHealthCheck } from "@/lib/certification/batch-health";
import {
  batchHealthFixLinkFor,
  compactBatchHealthDetail,
  skippedBatchHealthFixLink,
} from "@/lib/certification/batch-health-links";
import { InfoHint } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

function CheckChip({
  check,
  facilityId,
}: {
  check: BatchHealthCheck;
  facilityId: string;
}) {
  const icon =
    check.status === "met" ? (
      <CheckCircle size={14} weight="fill" className="text-[var(--st-ok)]" />
    ) : check.status === "unmet" ? (
      <Warning size={14} weight="fill" className="text-[var(--st-wait)]" />
    ) : (
      <Circle size={14} className="text-[var(--color-text-quaternary)]" />
    );

  const fix =
    check.status === "unmet" ? batchHealthFixLinkFor(check, facilityId) : null;
  const skippedFix =
    check.status === "skipped" ? skippedBatchHealthFixLink(facilityId) : null;

  return (
    <div
      className={cn(
        "flex min-w-[220px] flex-1 flex-col gap-8 border px-12 py-10",
        check.status === "unmet"
          ? "border-[var(--st-wait-border)] bg-[var(--st-wait-bg)]"
          : "border-[var(--color-border-tertiary)] bg-[var(--paper)]",
        check.status === "skipped" && "bg-[var(--color-surface-light)]"
      )}
    >
      <div className="flex items-start gap-8">
        <span className="mt-1 shrink-0">{icon}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-center gap-6">
            <span
              className={cn(
                "body-caption font-medium",
                check.status === "skipped"
                  ? "text-[var(--color-text-tertiary)]"
                  : "text-[var(--color-text-primary)]"
              )}
            >
              {check.label}
            </span>
            {check.detail && <InfoHint>{check.detail}</InfoHint>}
          </div>
        </div>
      </div>
      {fix && (
        <Link
          href={fix.href}
          className="body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
        >
          {fix.label}
        </Link>
      )}
      {skippedFix && (
        <Link
          href={skippedFix.href}
          className="inline-flex items-center gap-4 body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
        >
          {skippedFix.label}
          <ArrowSquareOut size={12} aria-hidden />
        </Link>
      )}
    </div>
  );
}

function NextAction({
  check,
  facilityId,
}: {
  check: BatchHealthCheck;
  facilityId: string;
}) {
  const fix =
    check.status === "skipped"
      ? skippedBatchHealthFixLink(facilityId)
      : batchHealthFixLinkFor(check, facilityId);
  const visibleDetail = check.detail
    ? compactBatchHealthDetail(check.detail)
    : null;

  return (
    <div className="flex flex-col gap-10 border border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] p-16">
      <span className="label-micro text-[var(--st-wait)]">Clear this gate</span>
      <div className="flex flex-col gap-4">
        <p className="body-medium font-medium text-[var(--color-text-primary)]">
          {check.label}
        </p>
        {visibleDetail && (
          <p className="body-caption text-[var(--color-text-secondary)]">
            {visibleDetail}
          </p>
        )}
      </div>
      <Link
        href={fix.href}
        className={cn(
          buttonVariants({ variant: "default", size: "small" }),
          "self-start"
        )}
      >
        {fix.label}
        {fix.href.startsWith("/") && <ArrowSquareOut size={12} aria-hidden />}
      </Link>
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

  return (
    <section
      className="flex flex-col gap-20 bg-[var(--panel-bg)] [border:var(--panel-border)] p-24"
      data-testid="batch-health-strip"
    >
      <div className="flex flex-col gap-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex max-w-[680px] flex-col gap-4">
          <h2 className="title-heading-3 text-[var(--color-text-primary)]">
            Submission gate
          </h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            Four checks decide whether this batch can enter a removal package.
            Clear the open gate before registry submission.
          </p>
        </div>
        {health &&
          (health.state === "ready" ? (
            <StatusBadge
              status="ready"
              label="Ready to certify"
              icon={<CheckCircle size={14} weight="fill" />}
            />
          ) : (
            <StatusBadge
              status="pending"
              label={`${health.issueCount} ${health.issueCount === 1 ? "issue" : "issues"}`}
              icon={<Warning size={14} weight="fill" />}
            />
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
          {error?.message ?? "Couldn't evaluate this batch's health."}
        </span>
      ) : health.state === "ready" ? (
        <div className="grid gap-16 lg:grid-cols-[1fr_280px]">
          <div className="flex flex-wrap gap-8">
            {health.checks.map((check) => (
              <CheckChip
                key={check.key}
                check={check}
                facilityId={facilityId}
              />
            ))}
          </div>
          <div className="flex flex-col justify-center gap-4 border border-[var(--st-ok-border)] bg-[var(--st-ok-bg)] p-16">
            <span className="label-micro text-[var(--st-ok)]">Ready</span>
            <p className="body-small text-[var(--color-text-secondary)]">
              This batch is complete enough for removal selection.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-16 lg:grid-cols-[1fr_280px]">
          <div className="flex flex-wrap gap-8">
            {health.checks.map((check) => (
              <CheckChip
                key={check.key}
                check={check}
                facilityId={facilityId}
              />
            ))}
          </div>
          <NextAction
            check={
              health.checks.find((check) => check.status === "unmet") ??
              health.checks[0]
            }
            facilityId={facilityId}
          />
        </div>
      )}
    </section>
  );
}
