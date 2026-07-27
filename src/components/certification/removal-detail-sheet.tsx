/**
 * RemovalDetailSheet — the read-only quick view for a Removal, opened from the
 * Removals table via `?removal=<id>`. Shows status, reporting window, member
 * batches, submission identity, and the readiness verdict. Every actionable
 * removal routes through the guided confirmation flow so the operator can
 * inspect the exact batches and readiness checks before submitting.
 *
 * Built on SlideOverPanel rather than EntitySideSheet because the quick view
 * is read-only with a bespoke Review & submit action, not the
 * view↔edit form lifecycle EntitySideSheet models.
 */
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, buttonVariants } from "@/components/ui";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { deriveRemovalStatus } from "@/lib/certification/status";
import { formatDateRange } from "@/lib/format-utils";
import { EnvBanner } from "./env-banner";
import { RegistryRecordLink } from "./registry-record-link";
import { RemovalCarbonBreakdown } from "./removal-carbon-breakdown";
import { SourcesPanel } from "./sources-panel";
import { SubmissionNotes } from "./submission-notes";
import { buildSubmissionWarningNotes } from "./submission-warning-notes";
import { SyncEventLog } from "./sync-event-log";
import type { RemovalListRow } from "./removal-list-state";

interface RemovalDetailSheetProps {
  summary: RemovalListRow;
  isProduction: boolean;
  facilityId: string;
  open: boolean;
  onClose: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <div className="body-small text-[var(--color-text-primary)]">{children}</div>
    </div>
  );
}

function ReadinessBlock({ summary }: { summary: RemovalListRow }) {
  if (summary.enrichmentStatus === "unavailable" || !summary.readiness) {
    return (
      <div className="flex flex-col items-start gap-8 border-l-2 border-[var(--color-signal-orange)] pl-12 py-4">
        <p className="body-small text-[var(--color-text-primary)]">
          Readiness unavailable for this Removal.
        </p>
        <Button
          variant="default"
          size="small"
          onClick={() => void summary.retry?.()}
        >
          Retry readiness
        </Button>
      </div>
    );
  }
  const { state, reasons, advisories } = summary.readiness;
  if (state === "ready") {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex items-center gap-8 border-l-2 border-[var(--st-ok)] pl-12 py-4">
          <CheckCircleIcon
            size={16}
            weight="fill"
            aria-hidden
            className="shrink-0 text-[var(--st-ok)]"
          />
          <span className="body-small text-[var(--color-text-primary)]">
            Ready to submit —{" "}
            {advisories.length > 0
              ? "blocking preconditions met."
              : "all preconditions met."}
          </span>
        </div>
        <AdvisoryRows advisories={advisories} />
      </div>
    );
  }
  if (state === "blocked") {
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-6 border-l-2 border-[var(--color-signal-orange)] pl-12 py-4">
          <span className="body-small font-medium text-[var(--color-text-primary)]">
            Blocked — resolve before submitting:
          </span>
          <ul className="flex flex-col gap-4">
            {reasons.map((reason) => (
              <li key={reason} className="flex items-start gap-6">
                <WarningIcon
                  size={14}
                  weight="fill"
                  aria-hidden
                  className="mt-2 shrink-0 text-[var(--color-signal-orange)]"
                />
                <span className="body-caption text-[var(--color-text-secondary)]">
                  {reason}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <AdvisoryRows advisories={advisories} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-8">
      <p className="body-small text-[var(--color-text-secondary)]">
        {state === "inProgress"
          ? "A submission is in progress."
          : "This removal has been submitted to the registry."}
      </p>
      <AdvisoryRows advisories={advisories} showSubmissionNote={false} />
    </div>
  );
}

function AdvisoryRows({
  advisories,
  showSubmissionNote = true,
}: {
  advisories: string[];
  showSubmissionNote?: boolean;
}) {
  if (advisories.length === 0) return null;
  return (
    <ul className="flex flex-col gap-4 border-l-2 border-[var(--color-signal-orange)] pl-12 py-4">
      {advisories.map((advisory) => (
        <li key={advisory} className="flex items-start gap-6">
          <WarningIcon
            size={14}
            weight="fill"
            aria-hidden
            className="mt-2 shrink-0 text-[var(--color-signal-orange)]"
          />
          {showSubmissionNote ? (
            <span className="body-caption text-[var(--color-text-secondary)]">
              Advisory — {advisory}. Submission remains available.
            </span>
          ) : (
            <span className="body-caption text-[var(--color-text-secondary)]">
              Advisory — {advisory}.
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function RemovalReviewAction({
  isActionable,
  reviewHref,
}: {
  isActionable: boolean;
  reviewHref: string;
}) {
  if (!isActionable) return null;
  return (
    <Link
      href={reviewHref}
      className={buttonVariants({
        variant: "primary",
        className: "flex-1",
      })}
    >
      Review &amp; submit
    </Link>
  );
}

export function RemovalDetailSheet({
  summary,
  isProduction,
  facilityId,
  open,
  onClose,
}: RemovalDetailSheetProps) {
  const derived = deriveRemovalStatus({
    local: summary.local,
    lockInFlight: summary.lockInFlight,
  });
  const state = summary.readiness?.state ?? null;
  const submissionWarningNotes = buildSubmissionWarningNotes(
    summary.submissionWarnings,
  );
  // The workflow may only be (re)entered while something still needs doing:
  // `ready` (submit it) or `blocked` (resolve preconditions). A `submitted`
  // removal is done, and an `inProgress` one is mid-flight — neither offers an
  // action, so the sheet stays read-only (the server would refuse a resubmit
  // anyway; this just stops offering a dead-end control).
  const isActionable =
    summary.enrichmentStatus === "available" &&
    (state === "ready" || state === "blocked");

  // "Review & submit" resumes the New-Removal wizard directly on this removal.
  // The legacy `/removals/[id]/review` route only redirects here (dropping any
  // `?step=`), so we skip the hop and build the resume URL it resolves to.
  const reviewHref = `/certification/removals?resume=${encodeURIComponent(
    summary.removalId,
  )}&facility=${encodeURIComponent(facilityId)}`;

  const window =
    summary.startedOn && summary.completedOn
      ? formatDateRange(summary.startedOn, summary.completedOn)
      : "Set on submit";

  return (
    <SlideOverPanel.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <SlideOverPanel.Content size="default">
        <SlideOverPanel.Header showClose>
          <SlideOverPanel.Title>
            Removal {summary.removalId.slice(0, 8)}…
          </SlideOverPanel.Title>
          <SlideOverPanel.Description>{window}</SlideOverPanel.Description>
        </SlideOverPanel.Header>

        <SlideOverPanel.Body className="flex flex-col gap-24">
          <EnvBanner isProduction={isProduction} variant="inline" />

          <div className="flex items-center justify-between gap-12">
            <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
              Status
            </span>
            <StatusBadge status={derived.value} label={derived.label} />
          </div>

          <RemovalCarbonBreakdown removalId={summary.removalId} enabled={open} />

          <Field label="Reporting window">{window}</Field>

          <Field label={`Credit batches (${summary.memberBatchCodes.length})`}>
            <span className="font-mono">
              {summary.memberBatchCodes.join(", ") || "—"}
            </span>
          </Field>

          {summary.externalId && (
            <Field label="Registry record">
              <RegistryRecordLink
                facilityId={facilityId}
                externalId={summary.externalId}
                version={summary.version}
                isProduction={isProduction}
                kind="removal"
              />
            </Field>
          )}

          <ReadinessBlock summary={summary} />

          {/*
            Non-blocking advisories (ADR 0015) — e.g. recorded startup/plant
            diesel the active template cannot carry. Distinct from readiness
            blockers above: the removal still submits.
          */}
          <SubmissionNotes notes={submissionWarningNotes} />

          {/*
            Supporting sources — mirror lineage documents (lab reports, BoLs,
            weigh-scale tickets, including per-transport-leg evidence) to
            Isometric so their source_ids ride into the Datapoint payloads at
            submit. This is the only place the candidate set is consumed: submit
            is resolve-only and never auto-mirrors, so without this panel
            `source_ids` is always empty and no evidence reaches the registry.
            (Restores the mount lost when evidence-step.tsx was deleted in the
            2026-06-04 certify redesign.)
          */}
          <SourcesPanel
            removalId={summary.removalId}
            editable={derived.isActionable}
          />

          <SyncEventLog
            events={summary.recentSyncEvents}
            compact
            label={`View removal sync history (${summary.recentSyncEvents.length})`}
          />
        </SlideOverPanel.Body>

        <SlideOverPanel.Footer className="justify-stretch">
          <RemovalReviewAction
            isActionable={isActionable}
            reviewHref={reviewHref}
          />
          <SlideOverPanel.Close>
            <Button
              variant={isActionable ? "default" : "primary"}
              className="flex-1"
            >
              Close
            </Button>
          </SlideOverPanel.Close>
        </SlideOverPanel.Footer>
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}
