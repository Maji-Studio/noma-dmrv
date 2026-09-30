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
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { DetailField, DetailSection } from "@/components/ui/detail-panel";
import {
  useDeleteRemoval,
  useFacilityCertifierSummary,
} from "@/hooks/use-certification";
import {
  deriveRemovalWorkflowStatus,
  type RemovalWorkflowStatus,
} from "@/lib/certification/status";
import { MISSING_VALUE, pluralize } from "@/lib/copy-utils";
import { formatDateRange } from "@/lib/format-utils";
import { isometricRegistry } from "@/lib/isometric/links";
import { EnvBanner } from "./env-banner";
import { IsometricLink } from "./isometric-link";
import { ProductionBatchLinks } from "./production-batch-links";
import { RegistryRecordLink } from "./registry-record-link";
import { RemovalCarbonBreakdown } from "./removal-carbon-breakdown";
import { SourcesPanel } from "./sources-panel";
import { SubmissionNotes } from "./submission-notes";
import { buildSubmissionWarningNotes } from "./submission-warning-notes";
import { SyncEventLog } from "./sync-event-log";
import {
  canDeleteRemovalRow,
  removalDeletionTouchesRegistry,
  type RemovalListRow,
} from "./removal-list-state";
import { removalDeletionCopy } from "./removal-deletion-copy";
import { Notice } from "@/components/ui/notice";

interface RemovalDetailSheetProps {
  summary: RemovalListRow;
  isProduction: boolean;
  facilityId: string;
  open: boolean;
  onClose: () => void;
}

export function RemovalStorageSitesField({
  externalProjectId,
  isProduction,
}: {
  externalProjectId: string | null;
  isProduction: boolean;
}) {
  if (!externalProjectId) return null;

  const environment = isProduction ? "production" : "sandbox";

  return (
    <DetailField
      label="Storage sites"
      value={
        <IsometricLink
          href={isometricRegistry.storageSites({
            environment,
            externalProjectId,
          })}
        />
      }
    />
  );
}

function SubmissionStatusSection({
  summary,
  status,
}: {
  summary: RemovalListRow;
  status: RemovalWorkflowStatus;
}) {
  return (
    <DetailSection title="Submission status" divider={false}>
      <DetailField
        label="Status"
        value={<StatusBadge status={status.value} label={status.label} />}
        valuePresent
      />

      {status.reasons.length > 0 && (
        <Notice tone="warning">
          <ul className="flex flex-col gap-6">
            {status.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Notice>
      )}

      {status.canRetry && (
        <Button
          variant="default"
          size="small"
          className="self-start"
          onClick={() => void summary.retry?.()}
        >
          Retry
        </Button>
      )}
    </DetailSection>
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
  const { data: certifierSummary } = useFacilityCertifierSummary(
    facilityId,
    open,
  );
  const externalProjectId =
    certifierSummary?.mapping?.externalProjectId ?? null;
  const workflowStatus = deriveRemovalWorkflowStatus({
    local: summary.local,
    lockInFlight: summary.lockInFlight,
    submissionInterrupted: summary.submissionInterrupted,
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

  // Deletion mirrors the server rule: never-finalized only. With registry
  // history the draft GHG Entry and Biochar Applications are removed from
  // Isometric before the local record goes. No role gate yet (issue #746).
  const touchesRegistry = removalDeletionTouchesRegistry(summary);
  const canDelete = canDeleteRemovalRow(summary);
  const deleteCopy = removalDeletionCopy(touchesRegistry);
  const deleteMutation = useDeleteRemoval();
  const toast = useToast();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

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
    <>
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

            <SubmissionStatusSection summary={summary} status={workflowStatus} />

            {summary.externalId && (
              <RemovalCarbonBreakdown
                removalId={summary.removalId}
                enabled={open}
              />
            )}

            <DetailSection title="Removal">
              <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
                <DetailField label="Reporting window" value={window} />
                <DetailField
                  label={`Credit batches (${summary.memberBatchCodes.length})`}
                  value={
                    <span className="font-mono">
                      {summary.memberBatchCodes.join(", ") || MISSING_VALUE.none}
                    </span>
                  }
                />

                {summary.externalId && (
                  <DetailField
                    label="Registry record"
                    value={
                      <RegistryRecordLink
                        facilityId={facilityId}
                        externalId={summary.externalId}
                        version={summary.version}
                        isProduction={isProduction}
                        kind="removal"
                      />
                    }
                  />
                )}

                <ProductionBatchLinks
                  removalId={summary.removalId}
                  isProduction={isProduction}
                  enabled={open}
                />

                <RemovalStorageSitesField
                  externalProjectId={externalProjectId}
                  isProduction={isProduction}
                />

                {summary.evidenceHealth && (
                  <DetailField
                    label="Evidence attachments"
                    value={
                      <span>
                        {summary.evidenceHealth.label}
                        {summary.evidenceHealth.totalCount > 0
                          ? `: ${summary.evidenceHealth.verifiedCount} of ${summary.evidenceHealth.totalCount} intended ${pluralize(summary.evidenceHealth.totalCount, "target")} verified`
                          : ""}
                      </span>
                    }
                  />
                )}
              </div>
            </DetailSection>

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
                label={`Submission history (${summary.recentSyncEvents.length})`}
              />
            )}
          </SlideOverPanel.Body>

          <SlideOverPanel.Footer className="justify-stretch">
            {canDelete && (
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deleteMutation.isPending}
              >
                {deleteCopy.actionLabel}
              </Button>
            )}
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
      {/* Sibling of the sheet, not a child, so Base UI does not treat the
          confirmation as a nested dialog of the sheet. */}
      <DeleteConfirmDialog
        isOpen={deleteConfirmOpen}
        title={deleteCopy.title}
        message={deleteCopy.message}
        onCancel={() => {
          setDeleteConfirmOpen(false);
          deleteMutation.reset();
        }}
        onConfirm={() => {
          deleteMutation.mutate(
            { facilityId, removalId: summary.removalId },
            {
              onSuccess: () => {
                setDeleteConfirmOpen(false);
                toast.success(deleteCopy.successToast);
                onClose();
              },
            },
          );
        }}
        isPending={deleteMutation.isPending}
        errorMessage={
          deleteMutation.error instanceof Error
            ? deleteMutation.error.message
            : undefined
        }
        confirmLabel={deleteCopy.actionLabel}
        pendingLabel={deleteCopy.pendingLabel}
      />
    </>
  );
}
