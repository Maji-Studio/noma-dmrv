/**
 * CreditBatchHealthStrip — the batch health check as a compact checklist
 * strip (visual design plan, Phase 5). Same `useBatchHealth` classifier as
 * the New-Removal wizard's gate (the two can never disagree); the full-panel
 * CheckRow list is condensed into one row of per-check chips, each unmet
 * chip linking to where the record is actually fixed. A `skipped` transport
 * check is a facility-setup concern — it links to certification settings and
 * never counts as a batch issue.
 */
"use client";

import Link from "next/link";
import {
  ArrowSquareOut,
  CheckCircle,
  Circle,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { useBatchHealth } from "@/hooks/use-certification";
import type {
  BatchHealthCheck,
  BatchHealthCheckKey,
  BatchHealthFixTarget,
} from "@/lib/certification/batch-health";
import { certificationSettingsHref } from "@/lib/certification/links";
import { InfoHint } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/ui/status-badge";

interface FixLink {
  label: string;
  href: string;
}

// Where each unmet batch-level check is fixed (design doc §6) — mirrors the
// full panel's mapping. `batchDetails` resolves on this page: the chip
// anchors to the read/edit section below.
function fixLinkFor(check: BatchHealthCheck, facilityId: string): FixLink {
  const target = check.fixTarget ?? fallbackFixTarget(check.key);
  switch (target) {
    case "batchDetails":
      return {
        label: check.key === "production" ? "Link applications" : "Edit details",
        href: "#batch-details",
      };
    case "productionRuns":
      return { label: "Link production data", href: `/production-runs?facility=${facilityId}` };
    case "biocharProducts":
      return { label: "Link production run", href: `/biochar-products?facility=${facilityId}` };
    case "deliveries":
    case "deliveryDistances":
      return { label: "Review deliveries", href: `/deliveries?facility=${facilityId}` };
    case "sourceData":
      return { label: "Review source data", href: `/production-runs?facility=${facilityId}` };
  }
}

function fallbackFixTarget(key: BatchHealthCheckKey): BatchHealthFixTarget {
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
    check.status === "unmet" ? fixLinkFor(check, facilityId) : null;
  const skippedFix =
    check.status === "skipped"
      ? { label: "Finish facility setup", href: certificationSettingsHref(facilityId) }
      : null;

  return (
    <div className="flex items-center gap-6 border border-[var(--color-border-tertiary)] px-10 py-6">
      {icon}
      <span
        className={[
          "body-caption font-medium",
          check.status === "skipped"
            ? "text-[var(--color-text-tertiary)]"
            : "text-[var(--color-text-primary)]",
        ].join(" ")}
      >
        {check.label}
      </span>
      {check.detail && <InfoHint>{check.detail}</InfoHint>}
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
      className="flex flex-col gap-12 bg-[var(--panel-bg)] [border:var(--panel-border)] px-20 py-14"
      data-testid="batch-health-strip"
    >
      <div className="flex items-center justify-between gap-16">
        <h2 className="label-micro text-[var(--color-text-primary)]">
          Health check
        </h2>
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
        <span className="body-caption text-[var(--color-text-tertiary)]" aria-busy="true">
          Evaluating…
        </span>
      ) : error || !health ? (
        <span className="body-caption text-[var(--st-wait)]">
          {error?.message ?? "Couldn't evaluate this batch's health."}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-8">
          {health.checks.map((check) => (
            <CheckChip key={check.key} check={check} facilityId={facilityId} />
          ))}
        </div>
      )}
    </section>
  );
}
