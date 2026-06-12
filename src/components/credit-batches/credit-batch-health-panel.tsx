/**
 * CreditBatchHealthPanel — the batch-grain sibling of the removal-level
 * requirements shown on the New-Removal wizard's confirm-&-submit step
 * (`certification/new-removal-dialog/submit-step.tsx`).
 * It answers "is this batch complete enough to group into a removal, and if not,
 * what's missing and where do I fix it?" Driven by `useBatchHealth`, which runs
 * the shared pure
 * classifier server-side so this panel, the New-Removal wizard's selection gate,
 * and any overview hint can never disagree on whether a batch is "ready".
 *
 * Each unmet check carries a smart fix link to wherever it's actually resolved
 * (design doc §6): carbon & durability inputs on the batch's own form (anchored
 * below on this page), production lineage on production runs, transport legs on
 * biochar products (where biochar distribution legs are edited/auto-derived). A
 * `skipped` transport check (facility setup not done) is a
 * removal/facility-level concern, so it links to certification settings and does
 * NOT count as a batch issue.
 */
"use client";

import Link from "next/link";
import {
  ArrowSquareOut,
  CheckCircle,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { useBatchHealth } from "@/hooks/use-certification";
import type {
  BatchHealthCheck,
  BatchHealthCheckKey,
  BatchHealthFixTarget,
} from "@/lib/certification/batch-health";
import { certificationSettingsHref } from "@/lib/certification/links";
import { CheckRow } from "@/components/certification/check-row";

interface FixLink {
  label: string;
  href: string;
}

// Where each unmet batch-level check is fixed (design doc §6). All targets are
// in-app, so plain Next <Link> navigation; the facility param keeps the target
// page scoped to this batch's facility.
function fixLinkFor(check: BatchHealthCheck, facilityId: string): FixLink {
  const target = check.fixTarget ?? fallbackFixTarget(check.key);
  switch (target) {
    case "batchDetails":
      // Carbon & durability inputs resolve from the batch's linked lab samples /
      // applications, edited via the form anchored below on this same page.
      return {
        label: check.key === "production" ? "Link applications" : "Edit batch details",
        href: "#batch-details",
      };
    case "productionRuns":
      return {
        label: "Link production data",
        href: `/production-runs?facility=${facilityId}`,
      };
    case "biocharProducts":
      return {
        label: "Link production run",
        href: `/biochar-products?facility=${facilityId}`,
      };
    case "deliveries":
      return {
        label: "Review deliveries",
        href: `/deliveries?facility=${facilityId}`,
      };
    case "deliveryDistances":
      // Transport legs are auto-derived: feedstock legs from the supplier's
      // stored distance, biochar distribution legs from each delivery's
      // customer-location distance + delivered mass. A gap means a delivery is
      // missing or its destination has no stored distance, so the deliveries
      // page is the actionable target (the biochar product sheet only shows a
      // read-only summary).
      return {
        label: "Review delivery distances",
        href: `/deliveries?facility=${facilityId}`,
      };
    case "sourceData":
      return {
        label: "Review source data",
        href: `/production-runs?facility=${facilityId}`,
      };
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

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
      {children}
    </section>
  );
}

function PanelHeader({ summary }: { summary: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-16 border-b border-[var(--color-border-tertiary)] px-20 py-16">
      <h2 className="title-heading-3">Health check</h2>
      {summary}
    </div>
  );
}

export function CreditBatchHealthPanel({
  creditBatchId,
  facilityId,
}: {
  creditBatchId: string;
  facilityId: string;
}) {
  const { data: health, isLoading, error } = useBatchHealth(creditBatchId);

  if (isLoading) {
    return (
      <PanelShell>
        <PanelHeader
          summary={
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Evaluating…
            </span>
          }
        />
        <div className="px-20 py-24" aria-busy="true">
          <span className="body-small text-[var(--color-text-tertiary)]">
            Checking this batch&apos;s data completeness…
          </span>
        </div>
      </PanelShell>
    );
  }

  if (error || !health) {
    return (
      <PanelShell>
        <PanelHeader summary={null} />
        <div className="px-20 py-24">
          <span className="body-small text-[var(--color-signal-orange)]">
            {error?.message ?? "Couldn't evaluate this batch's health."}
          </span>
        </div>
      </PanelShell>
    );
  }

  const isReady = health.state === "ready";
  const summary = isReady ? (
    <span className="inline-flex items-center gap-6 border border-[var(--color-signal-green)] bg-[var(--color-signal-green-light)] px-10 py-4 body-caption font-medium text-[var(--color-signal-green)]">
      <CheckCircle size={14} weight="fill" aria-hidden />
      Ready to certify
    </span>
  ) : (
    <span className="inline-flex items-center gap-6 border border-[var(--color-signal-orange)] bg-[var(--color-signal-orange-light)] px-10 py-4 body-caption font-medium text-[var(--color-signal-orange-strong)]">
      <Warning size={14} weight="fill" aria-hidden />
      {health.issueCount} {health.issueCount === 1 ? "issue" : "issues"}
    </span>
  );

  return (
    <PanelShell>
      <PanelHeader summary={summary} />
      <ul className="flex flex-col">
        {health.checks.map((check, index) => (
          <CheckRow
            key={check.key}
            status={check.status}
            label={check.label}
            detail={check.detail}
            isFirst={index === 0}
            paddingX={20}
            fix={
              check.status === "unmet"
                ? fixLinkFor(check, facilityId)
                : null
            }
          >
            {check.status === "skipped" && (
              <Link
                href={certificationSettingsHref(facilityId)}
                className="inline-flex shrink-0 items-center gap-4 self-center body-caption font-medium text-[var(--color-interaction)] underline-offset-2 hover:underline"
              >
                Finish facility setup
                <ArrowSquareOut size={12} aria-hidden />
              </Link>
            )}
          </CheckRow>
        ))}
      </ul>
    </PanelShell>
  );
}
