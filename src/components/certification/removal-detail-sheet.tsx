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
import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, buttonVariants } from "@/components/ui";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  deriveRemovalWorkflowStatus,
  type RemovalWorkflowStatus,
} from "@/lib/certification/status";
import { formatDateRange } from "@/lib/format-utils";
import { pluralize } from "@/lib/copy-utils";
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

function SubmissionStatusPanel({
  summary,
  status,
}: {
  summary: RemovalListRow;
  status: RemovalWorkflowStatus;
}) {
  return (
    <section
      aria-labelledby="removal-submission-status"
      className="border-y border-[var(--color-border-secondary)] py-12"
    >
      <div className="flex items-center justify-between gap-12">
        <h3
          id="removal-submission-status"
          className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]"
        >
          Submission status
        </h3>
        <StatusBadge status={status.value} label={status.label} />
      </div>

      {status.reasons.length > 0 && (
        <ul className="mt-10 flex flex-col gap-6 border-l-2 border-[var(--color-signal-orange)] pl-12">
          {status.reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-6">
              <WarningIcon
                size={14}
                weight="fill"
                aria-hidden
                className="mt-2 shrink-0 text-[var(--color-signal-orange)]"
              />
              <span className="body-small text-[var(--color-text-secondary)]">
                {reason}
              </span>
            </li>
          ))}
        </ul>
      )}

      {status.canRetry && (
        <Button
          variant="default"
          size="small"
          className="mt-10"
          onClick={() => void summary.retry?.()}
        >
          Retry
        </Button>
      )}
    </section>
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
  const workflowStatus = deriveRemovalWorkflowStatus({
    local: summary.local,
    lockInFlight: summary.lockInFlight,
    enrichmentStatus: summary.enrichmentStatus,
    readiness: summary.readiness,
  });
  const submissionWarningNotes = buildSubmissionWarningNotes(
    summary.submissionWarnings,
  );
  // The workflow may only be (re)entered while something still needs doing:
  // `ready` (submit it) or `blocked` (resolve preconditions). A `submitted`
  // removal is done, and an `inProgress` one is mid-flight — neither offers an
  // action, so the sheet stays read-only (the server would refuse a resubmit
  // anyway; this just stops offering a dead-end control).
  const isActionable = workflowStatus.isActionable;

  // "Review & submit" resumes the New-Removal wizard directly on this removal.
  // The legacy `/removals/[id]/review` route only redirects here (dropping any
  // `?step=`), so we skip the hop and build the resume URL it resolves to.
  const reviewHref = `/certification/removals?resume=${encodeURIComponent(
    summary.removalId,
  )}&facility=${encodeURIComponent(facilityId)}`;

  const hasReportingWindow = summary.startedOn && summary.completedOn;
  const window =
    hasReportingWindow
      ? formatDateRange(summary.startedOn, summary.completedOn)
      : "Set when submitted";

  return (
    <SlideOverPanel.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <SlideOverPanel.Content size="default">
        <SlideOverPanel.Header showClose>
          <SlideOverPanel.Title>
            Removal {summary.removalId.slice(0, 8)}…
          </SlideOverPanel.Title>
          {hasReportingWindow && (
            <SlideOverPanel.Description>{window}</SlideOverPanel.Description>
          )}
        </SlideOverPanel.Header>

        <SlideOverPanel.Body className="flex flex-col gap-24">
          <EnvBanner isProduction={isProduction} variant="inline" />

          <SubmissionStatusPanel summary={summary} status={workflowStatus} />

          {summary.externalId && (
            <RemovalCarbonBreakdown
              removalId={summary.removalId}
              enabled={open}
            />
          )}

          <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
            <Field label="Reporting window">{window}</Field>
            <Field label={`Credit batches (${summary.memberBatchCodes.length})`}>
              <span className="font-mono">
                {summary.memberBatchCodes.join(", ") || "None"}
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

            {summary.evidenceHealth && (
              <Field label="Evidence attachments">
                <span>
                  {summary.evidenceHealth.label}
                  {summary.evidenceHealth.totalCount > 0
                    ? `: ${summary.evidenceHealth.verifiedCount} of ${summary.evidenceHealth.totalCount} intended ${pluralize(summary.evidenceHealth.totalCount, "target")} verified`
                    : ""}
                </span>
              </Field>
            )}
          </div>

          {/*
            Non-blocking advisories (ADR 0015) — e.g. recorded startup/plant
            diesel the active template cannot carry. Distinct from readiness
            blockers above: the removal still submits.
          */}
          <SubmissionNotes notes={submissionWarningNotes} />

          {/*
            Registry value sources prepare mapped evidence for its intended
            registry Datapoint targets. Application evidence stays on its
            owning Application until the Biochar Application integration can
            submit source_ids. This is the only place the candidate set is
            consumed: submit is resolve-only and never auto-mirrors.
            (Restores the mount lost when evidence-step.tsx was deleted in the
            2026-06-04 certify redesign.)
          */}
          <SourcesPanel
            removalId={summary.removalId}
            isEditable={isActionable}
          />

          {summary.recentSyncEvents.length > 0 && (
            <SyncEventLog
              events={summary.recentSyncEvents}
              compact
              label={`Submission history (${summary.recentSyncEvents.length})`}
            />
          )}
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
