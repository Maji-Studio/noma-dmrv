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

import { useFacilityClock } from "@/hooks/use-facility-context";
import { MultilineDetail } from "./multiline-detail";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useRemovalCarriedEntries } from "@/hooks/use-removal-carried-entries";
import { useRemovalDeleteAccess } from "@/hooks/use-removal-delete-access";
import { useToast } from "@/components/ui/toast";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { DetailField, DetailSection } from "@/components/ui/detail-panel";
import {
  useDeleteRemoval,
  useFacilityCertifierSummary,
} from "@/hooks/use-certification";
import { useRemovalSheetFacts } from "@/hooks/use-removal-sheet-facts";
import type { RemovalSheetFacts } from "@/lib/certification/removal-sheet-facts";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { recordHref } from "@/lib/record-links";
import {
  deriveRemovalWorkflowStatus,
  REMOVAL_FAILED_REVIEW_REASON,
  REMOVAL_INTERRUPTED_RECONCILE_REASON,
  type RemovalWorkflowStatus,
} from "@/lib/certification/status";
import { pluralize, TRY_AGAIN_LABEL } from "@/lib/copy-utils";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { isometricRegistry } from "@/lib/isometric/links";
import { CarriedEntriesSection, RevisionLateEntriesSection } from "./carried-entries";
import { EnvBanner } from "./env-banner";
import { IsometricLink } from "./isometric-link";
import { ProductionBatchLinks } from "./production-batch-links";
import { RegistryRecordLink } from "./registry-record-link";
import { RemovalCarbonBreakdown } from "./removal-carbon-breakdown";
import { SourcesPanel } from "./sources-panel";
import { SubmissionNotes } from "./submission-notes";
import { buildSubmissionWarningNotes } from "./submission-warning-notes";
import { SubmissionHistory } from "./submission-history";
import { RemovalRecords } from "./removal-records";
import { SubmissionOutcomeNotice, type NoticeOutcome } from "./submission-outcome-notice";
import { CertificationStatusBadge } from "./certification-status-badge";
import {
  canDeleteRemovalRow,
  removalDeletionTouchesRegistry,
  type RemovalListRow,
} from "./removal-list-state";
import { removalDeletionCopy } from "./removal-deletion-copy";
import type { StatusValue } from "@/components/ui/status-badge";
import { Notice } from "@/components/ui/notice";
import { ReadOnlyNotice } from "@/components/ui/read-only-notice";
import type { SheetReadOnly } from "@/lib/linked-record-read-only";
import type { RecordLockView } from "@/lib/record-lock-view";
import { RemovalCorrectionNotice } from "./removal-correction-needed";
import { RemovalResubmitNotice, ResubmitRemovalAction } from "./removal-resubmit-notice";
import { correctionStatus } from "@/lib/removal-correction-copy";
import { RemovalMissingRunsNotice } from "./removal-missing-runs-notice";
import { RemovalEvidenceLinksNotice } from "./removal-evidence-links-notice";

const ESTIMATE_NOTE = "Estimated before project emissions and registry verification. Isometric calculates the final net value.";
const CO2E_DIGITS = 1;
const DRY_MASS_DIGITS = 1;
const ALLOCATION_HINT = "Allocation is on each credit batch's Emissions tab.";

interface RemovalDetailSheetProps {
  /** Admin: may add a missed run to a credit batch. */
  canManage?: boolean;
  summary: RemovalListRow;
  isProduction: boolean;
  facilityId: string;
  open: boolean;
  onClose: () => void;
  /** Which Isometric returned, if any: shows "Correction needed" where the Removal has no `correction`. */
  lock?: RecordLockView;
  /** Set when the Removal's facility is archived or unchecked: nothing here can change it. */
  readOnly?: SheetReadOnly;
  /** The archived facility's own timezone, which the working facility list does not carry. */
  timeZone?: string;
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
          label="View on Isometric"
          href={isometricRegistry.storageSites({
            environment,
            externalProjectId,
          })}
        />
      }
    />
  );
}

/** Each credit batch code links to its page; codes alone until the facts load. */
function CreditBatchLinks({ facts, codes, facilityId }: { facts: RemovalSheetFacts | undefined; codes: string[]; facilityId: string }) {
  if (!facts) return <span className="font-mono">{codes.join(", ")}</span>;
  return (
    <span>
      {facts.batches.map((batch, index) => (
        <span key={batch.id}>
          {index > 0 && ", "}
          <Link href={recordHref("creditBatch", batch.id, { facilityId })} className={RECORD_CODE_LINK}>
            {batch.code}
          </Link>
        </span>
      ))}
    </span>
  );
}

/** The outcome the notice under the status tells, or null when nothing needs saying. */
export function submissionOutcomeFor(summary: RemovalListRow, status: RemovalWorkflowStatus): NoticeOutcome | null {
  if (status.kind === "submitted" || status.kind === "submitting" || status.kind === "superseded") return null;
  const latest = summary.submissionAttempts[0]?.outcome;
  // A retry of an interrupted draft can stop on drift before it claims anything, so the status stays
  // "interrupted": the red stop still leads.
  if (latest?.kind === "differs") return latest;
  if (status.kind === "interrupted") return { kind: "interrupted" };
  return latest && latest.kind !== "submitted" ? latest : null;
}

/**
 * What the sheet header's badge says. A draft reads "Not submitted" whether or
 * not it can be sent yet: the count of things to fix sits in the footer next
 * to Review & submit, not in the status (#1554).
 */
export function sheetStatusFor(status: RemovalWorkflowStatus): { value: StatusValue; label: string } {
  if (status.kind === "blocked" || status.kind === "ready") return { value: "draft", label: "Not submitted" };
  return { value: status.value, label: status.label };
}

/** The one next step for states no notice speaks for, or null. */
export function nextStepLine(status: RemovalWorkflowStatus): string | null {
  switch (status.kind) {
    case "checking":
      return "Checking whether this Removal is ready.";
    case "unavailable":
      return "The checks could not load.";
    case "submitting":
      return "noma is sending this Removal to Isometric. This can take a few minutes.";
    case "submitted":
      return "Isometric verifies it with the GHG Statement for its reporting period.";
    default:
      return null;
  }
}

/** The footer line next to Review & submit: how many things block sending. */
export function thingsToFixLine(status: RemovalWorkflowStatus): string | null {
  if (status.kind !== "blocked" || status.reasons.length === 0) return null;
  const count = status.reasons.length;
  return `${count} ${pluralize(count, "thing", "things")} to fix before submitting`;
}

/**
 * The untitled block under the header: the one next step, the outcome notice
 * and Retry. The sheet adds the returned, missing-runs and evidence-links
 * notices beside it. Empty states render nothing, so the block is gone.
 */
function SheetStatusBlock({
  summary,
  status,
  facilityId,
  timeZone,
  readOnly = false,
}: {
  summary: RemovalListRow;
  status: RemovalWorkflowStatus;
  facilityId: string;
  timeZone: string;
  /** Nothing here can change the Removal, so no reason, retry or fix is offered. */
  readOnly?: boolean;
}) {
  const outcome = submissionOutcomeFor(summary, status);
  // The outcome notice replaces the two generic "review the history" reasons.
  // Readiness blockers belong to Review & submit, whatever the state, so the sheet never lists them.
  const blockers = summary.readiness?.state === "blocked" ? summary.readiness.reasons : [];
  const reasons = status.kind === "blocked"
    ? []
    : status.reasons.filter((reason) =>
        !blockers.includes(reason)
        && !(outcome && (reason === REMOVAL_FAILED_REVIEW_REASON || reason === REMOVAL_INTERRUPTED_RECONCILE_REASON)));
  const line = nextStepLine(status);
  return (
    <>
      {line && <p className="body-small text-[var(--color-text-secondary)]">{line}</p>}

      {outcome && (
        <SubmissionOutcomeNotice
          outcome={outcome}
          facilityId={facilityId}
          timeZone={timeZone}
          finalized={summary.hasFinalizedSubmission}
          readOnly={readOnly}
        />
      )}

      {!readOnly && reasons.length > 0 && (
        <Notice tone="warning">
          <ul className="flex flex-col gap-6">
            {reasons.map((reason) => (
              <li key={reason}><MultilineDetail>{reason}</MultilineDetail></li>
            ))}
          </ul>
        </Notice>
      )}

      {status.canRetry && !readOnly && (
        <Button variant="default" size="small" className="self-start" onClick={() => void summary.retry?.()}>
          Retry
        </Button>
      )}
    </>
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
      className={buttonVariants({ variant: "primary" })}
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
  lock,
  canManage = false,
  readOnly,
  timeZone: facilityTimeZone,
}: RemovalDetailSheetProps) {
  const { timeZone } = useFacilityClock(facilityId, { timeZone: facilityTimeZone });
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
  // A replaced Removal never sends anything, so it is the one state that
  // skips the carried-entries read.
  const { data: removalEntries } = useRemovalCarriedEntries(summary.removalId, { enabled: open && workflowStatus.kind !== "superseded" });
  const carriedEntries = removalEntries?.carriedEntries;
  const lateEntries = removalEntries?.lateEntries;
  // A returned Removal with its correction window open shows the Returned or
  // Resubmit needed status and one notice in place of #1134's lock-based one.
  const { correction } = summary;
  const shownStatus = correction ? { ...workflowStatus, ...correctionStatus(correction) } : workflowStatus;
  const submissionWarningNotes = buildSubmissionWarningNotes(
    [...summary.submissionWarnings, ...(summary.readiness?.transportVehicleAdvisories ?? [])],
  );
  // The workflow may only be (re)entered while something still needs doing:
  // `ready` (submit it) or `blocked` (resolve preconditions). A `submitted`
  // removal is done, and an `inProgress` one is mid-flight — neither offers an
  // action, so the sheet stays read-only (the server would refuse a resubmit
  // anyway; this just stops offering a dead-end control).
  const isActionable = workflowStatus.isActionable;

  // Deletion mirrors the server rule: never-finalized only, and once the
  // Removal touched the registry only viewers at the role floor (issue #746).
  // With registry history the draft GHG Entry and Biochar Applications are
  // removed from Isometric before the local record goes.
  const deleteAccess = useRemovalDeleteAccess(
    facilityId,
    summary.removalId,
    open,
  );
  const touchesRegistry = removalDeletionTouchesRegistry(summary, deleteAccess);
  const canDelete = canDeleteRemovalRow(summary, deleteAccess) && !readOnly;
  const deleteCopy = removalDeletionCopy(touchesRegistry);
  const deleteMutation = useDeleteRemoval();
  const toast = useToast();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // "Review & submit" resumes the New-Removal wizard directly on this removal.
  const reviewHref = `/removals?resume=${encodeURIComponent(
    summary.removalId,
  )}&facility=${encodeURIComponent(facilityId)}`;

  const sheetFacts = useRemovalSheetFacts(summary.removalId, { enabled: open });
  const facts = sheetFacts.data;
  // noma's own estimate from the credit batches; the registry's net figure stays in the registry card below.
  const co2eTonnes = facts?.co2eEstimateTonnes ?? null;
  // A failed facts read is a load failure, not missing data: hide the figures it feeds and offer a retry.
  const factsFailed = sheetFacts.isError;
  const headerStatus = sheetStatusFor(shownStatus);
  const thingsToFix = thingsToFixLine(workflowStatus);
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
            {/* The badge follows the code on its line and wraps under it on a phone; the code never truncates. */}
            <div className="flex flex-wrap items-center gap-x-12">
              <SlideOverPanel.Title>
                {summary.code}
              </SlideOverPanel.Title>
              <CertificationStatusBadge
                entityType="removal"
                entityId={summary.removalId}
                status={headerStatus.value}
                label={headerStatus.label}
              />
            </div>
            {hasReportingWindow && (
              <SlideOverPanel.Description>{window}</SlideOverPanel.Description>
            )}
          </SlideOverPanel.Header>

          <SlideOverPanel.Body className="flex flex-col gap-24">
            {readOnly && <ReadOnlyNotice readOnly={readOnly} />}
            <EnvBanner isProduction={isProduction} variant="inline" />

            {/* Status block: no title, the badge in the header says the state. Gone when nothing needs saying. */}
            <div className="peer/status flex flex-col gap-12 empty:hidden">
              <SheetStatusBlock summary={summary} status={shownStatus} facilityId={facilityId} timeZone={timeZone} readOnly={!!readOnly} />
              {correction ? (
                <RemovalResubmitNotice correction={correction} facilityId={facilityId} readOnly={!!readOnly} />
              ) : (
                <RemovalCorrectionNotice lock={lock} readOnly={!!readOnly} />
              )}
              <RemovalMissingRunsNotice batches={summary.missingProductionRuns} facilityId={facilityId} canManage={canManage && !readOnly} readOnly={!!readOnly} />
              <RemovalEvidenceLinksNotice links={summary.evidenceLinks} readOnly={!!readOnly} />
            </div>

            <DetailSection title="Removal" className="peer-empty/status:border-t-0 peer-empty/status:pt-0">
              {factsFailed && (
                <Notice
                  tone="error"
                  action={<Button variant="weak" size="small" busy={sheetFacts.isFetching} onClick={() => void sheetFacts.refetch()}>{TRY_AGAIN_LABEL}</Button>}
                >
                  The figures for this Removal could not be loaded.
                </Notice>
              )}
              <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
                {!factsFailed && <DetailField
                  label="Estimated CO₂e stored"
                  hint={ESTIMATE_NOTE}
                  value={co2eTonnes == null ? null : formatTonnes(co2eTonnes, { digits: CO2E_DIGITS, unit: "t CO₂e" })}
                  emptySituation="notYetComputed"
                  pending={sheetFacts.isLoading}
                />}
                {!factsFailed && <DetailField
                  label="Biochar dry mass"
                  value={facts?.dryTonnes == null ? null : formatTonnes(facts.dryTonnes, { digits: DRY_MASS_DIGITS })}
                  emptySituation="notYetComputed"
                  pending={sheetFacts.isLoading}
                />}
                <DetailField
                  label="Reporting window"
                  value={window}
                  valuePresent={Boolean(hasReportingWindow)}
                />
                <DetailField
                  label={`Credit batches (${summary.memberBatchCodes.length})`}
                  hint={ALLOCATION_HINT}
                  value={
                    summary.memberBatchCodes.length > 0 ? (
                      <CreditBatchLinks facts={facts} codes={summary.memberBatchCodes} facilityId={facilityId} />
                    ) : null
                  }
                  emptySituation="none"
                />
                {!factsFailed && <DetailField label="Facility" value={facts?.facilityName ?? null} pending={sheetFacts.isLoading} />}
              </div>

              {summary.externalId && (
                <RemovalCarbonBreakdown
                  removalId={summary.removalId}
                  enabled={open}
                />
              )}
            </DetailSection>

            <DetailSection title="Isometric">
              <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
                <DetailField label="Destination" value={isProduction ? "Production" : "Sandbox"} valuePresent />
                <DetailField
                  label="Project"
                  value={
                    externalProjectId ? (
                      <IsometricLink
                        label={externalProjectId}
                        href={isometricRegistry.certifyProject({ environment: isProduction ? "production" : "sandbox", externalProjectId })}
                      />
                    ) : null
                  }
                  valuePresent={Boolean(externalProjectId)}
                />
                {!factsFailed && <DetailField
                  className="sm:col-span-2"
                  label="Durability and sampling"
                  value={facts?.durabilityLabel ? `${facts.durabilityLabel}, ${facts.samplingLabel?.toLowerCase()}` : null}
                  pending={sheetFacts.isLoading}
                />}

                <RemovalStorageSitesField
                  externalProjectId={externalProjectId}
                  isProduction={isProduction}
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

              {/*
                Non-blocking advisories (ADR 0015) — e.g. recorded startup/plant
                diesel the active template cannot carry. Distinct from readiness
                blockers: the removal still submits.
              */}
              {!readOnly && <SubmissionNotes notes={submissionWarningNotes} />}

              {/*
                Registry value sources prepare mapped evidence for its intended
                registry Datapoint targets. Application evidence stays on its
                owning Application until the Biochar Application integration can
                submit source_ids. This is the only place the candidate set is
                consumed: submit is resolve-only and never auto-mirrors.
                Its files are prepared for the next submission, which this sheet cannot start.
              */}
              {!readOnly && (
                <SourcesPanel
                  removalId={summary.removalId}
                  isEditable={isActionable}
                />
              )}

              <SubmissionHistory
                attempts={summary.submissionAttempts}
                events={summary.recentSyncEvents}
                facilityId={facilityId}
                timeZone={timeZone}
              />
            </DetailSection>

            <DetailSection title="Records">
              <RemovalRecords removalId={summary.removalId} facilityId={facilityId} enabled={open} />
              <CarriedEntriesSection
                entries={carriedEntries}
                facilityId={facilityId}
                sent={workflowStatus.kind === "submitted"}
                readOnly={!!readOnly}
              />
              <RevisionLateEntriesSection entries={lateEntries} facilityId={facilityId} removalCode={summary.code} readOnly={!!readOnly} />
            </DetailSection>
          </SlideOverPanel.Body>

          <SlideOverPanel.Footer
            preview={!readOnly && thingsToFix ? <p className="body-small text-[var(--color-text-secondary)]">{thingsToFix}</p> : undefined}
          >
            {!readOnly && <ResubmitRemovalAction correction={correction} facilityId={facilityId} />}
            <RemovalReviewAction
              isActionable={isActionable && !readOnly}
              reviewHref={reviewHref}
            />
            {canDelete && (
              <Button
                variant="destructive"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={deleteMutation.isPending}
              >
                {deleteCopy.actionLabel}
              </Button>
            )}
            <SlideOverPanel.FooterClose />
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
      />
    </>
  );
}
