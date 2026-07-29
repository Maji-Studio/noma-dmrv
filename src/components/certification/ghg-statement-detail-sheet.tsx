/**
 * Compact GHG Statement workflow, aligned with the Removal detail sheet.
 * Isometric owns statement membership; noma exposes only the facts and actions
 * needed to review, generate a report, approve, refresh, and submit.
 */
"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import {
  useGhgStatementReports,
  useGhgStatementState,
  useRefreshGhgStatementStatus,
} from "@/hooks/use-certification";
import type { GhgStatementListItem } from "@/fn/certification/ghg-statements";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import type { GhgStatement } from "@/lib/isometric";
import { chooseGhgSubmitMode } from "@/lib/isometric/utils/ghg-statement-state";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { EnvBanner } from "./env-banner";
import { GhgStatementCarbonBreakdown } from "./ghg-statement-carbon-breakdown";
import { GhgStatementReportWorkflow } from "./ghg-statement-report-workflow";
import { GhgStatementSubmitDialog } from "./ghg-statement-submit-dialog";
import { RegistryRecordLink } from "./registry-record-link";
import { RemovalBatchesAccordion } from "./removal-batches-accordion";
import { SubmissionStatusBadge } from "./submission-status-badge";
import { SyncEventLog } from "./sync-event-log";

const ICON_SIZE = 14;
const SHORT_ID = 8;

interface GhgStatementDetailSheetProps {
  item: GhgStatementListItem;
  isProduction: boolean;
  open: boolean;
  onClose: () => void;
}

function statementPeriod(item: GhgStatementListItem): string {
  if (item.remotePeriodMissing) return "No period set";
  const { reportingPeriodStartOn } = item.statement;
  const reportingPeriodEndOn = item.effectiveReportingPeriodEndOn;
  return reportingPeriodStartOn
    ? formatDateRange(reportingPeriodStartOn, reportingPeriodEndOn)
    : `Ends ${formatDate(reportingPeriodEndOn)}`;
}

function verifierStatusLabel(remote: GhgStatement | null): string {
  if (!remote) return "Not created in Isometric";
  switch (remote.status) {
    case "DRAFT":
      return "Not sent to the verifier";
    case "AWAITING_VERIFICATION":
      return "In verification";
    case "VERIFIED":
      return "Verified";
    case "CREDITS_ISSUED":
      return "Credits issued";
    case "FAILED_VERIFICATION":
      return "Verification failed";
    default:
      return remote.status;
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <div className="body-small text-[var(--color-text-primary)]">
        {children}
      </div>
    </div>
  );
}

export function GhgStatementDetailSheet({
  item,
  isProduction,
  open,
  onClose,
}: GhgStatementDetailSheetProps) {
  const period = statementPeriod(item);

  return (
    <SlideOverPanel.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <SlideOverPanel.Content size="default">
        <SlideOverPanel.Header showClose>
          <SlideOverPanel.Title>GHG Statement</SlideOverPanel.Title>
          <SlideOverPanel.Description>{period}</SlideOverPanel.Description>
        </SlideOverPanel.Header>

        <DetailState
          item={item}
          isProduction={isProduction}
          open={open}
        />
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}

function DetailState({
  item,
  isProduction,
  open,
}: {
  item: GhgStatementListItem;
  isProduction: boolean;
  open: boolean;
}) {
  const { statement } = item;
  const query = useGhgStatementState(statement.id);
  const reportsQuery = useGhgStatementReports(statement.id);
  const refreshMutation = useRefreshGhgStatementStatus();
  const toast = useToast();
  const [submitOpen, setSubmitOpen] = useState(false);

  if (query.isLoading) {
    return (
      <>
        <SlideOverPanel.Body>
          <p
            aria-busy="true"
            className="body-small text-[var(--color-text-tertiary)]"
          >
            Loading statement…
          </p>
        </SlideOverPanel.Body>
        <CloseFooter />
      </>
    );
  }

  if (query.error || !query.data) {
    return (
      <>
        <SlideOverPanel.Body>
          <p className="body-small text-[var(--clr-red)]" role="alert">
            Unable to load statement details.
          </p>
        </SlideOverPanel.Body>
        <CloseFooter />
      </>
    );
  }

  const { statementSubmission, linkedRemovals, remote, recentSyncEvents } =
    query.data;
  const derived = deriveSubmissionStatus(
    statementSubmission,
    statementSubmission ? isLockedInFlight(statementSubmission) : false,
    "ghgStatement",
  );
  const mode = remote ? chooseGhgSubmitMode(remote) : "submit";
  const hasLinkedRemovals = linkedRemovals.length > 0;
  const hasMembership = remote
    ? remote.ghg_entry_ids.length > 0
    : hasLinkedRemovals;
  const canGenerate = Boolean(remote?.ghg_entry_ids.length);
  const remoteUnavailable =
    Boolean(statementSubmission?.externalId) && remote === null;
  const generationUnavailableReason = canGenerate
    ? null
    : remoteUnavailable
      ? "Live Isometric statement data is unavailable. Refresh and try again."
      : remote
        ? "Add a live GHG Entry before generating a report."
        : "Create the GHG Statement before generating a report.";
  const canSubmit =
    Boolean(statementSubmission?.externalId) &&
    (mode === "submit" || mode === "resubmit") &&
    hasMembership;
  const isResubmit = mode === "resubmit";
  const blockedNote =
    mode === "blocked-awaiting"
      ? "The statement is in verification. No action is needed."
      : mode === "blocked-verified"
        ? "The statement is verified. No further submission is available."
        : (mode === "submit" || mode === "resubmit") && !hasMembership
          ? "No GHG Entries are available to submit."
          : null;

  const handleRefresh = () => {
    if (!statementSubmission) return;
    refreshMutation.mutate(statementSubmission.id, {
      onSuccess: (result) => toast.success(`Status: ${result.status}.`),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : "Refresh failed.",
        ),
    });
  };

  return (
    <>
      <SlideOverPanel.Body className="flex flex-col gap-24">
        <EnvBanner isProduction={isProduction} variant="inline" />

        <section
          aria-labelledby="ghg-statement-status"
          className="border-y border-[var(--color-border-secondary)] py-12"
        >
          <div className="flex items-center justify-between gap-12">
            <h3
              id="ghg-statement-status"
              className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]"
            >
              Statement status
            </h3>
            <StatusBadge status={derived.value} label={derived.label} />
          </div>
        </section>

        <GhgStatementCarbonBreakdown
          ghgStatementId={statement.id}
          enabled={open}
        />

        <div className="grid grid-cols-1 gap-16 sm:grid-cols-2">
          {statementSubmission?.externalId && (
            <Field label="Registry record">
              <RegistryRecordLink
                facilityId={statement.facilityId}
                externalId={statementSubmission.externalId}
                version={statementSubmission.version}
                isProduction={isProduction}
                kind="ghgStatement"
              />
            </Field>
          )}
          <Field label="Verifier status">
            {verifierStatusLabel(remote)}
          </Field>
        </div>

        <section className="flex flex-col gap-8">
          <h3 className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Linked Removals ({linkedRemovals.length})
          </h3>
          {linkedRemovals.length === 0 ? (
            <p className="body-small text-[var(--color-text-tertiary)]">
              No linked Removals.
            </p>
          ) : (
            <RemovalBatchesAccordion
              facilityId={statement.facilityId}
              entries={linkedRemovals.map(
                ({ removal, submission, creditBatches }) => ({
                  removalId: removal.id,
                  label:
                    submission?.externalId ??
                    `${removal.id.slice(0, SHORT_ID)}…`,
                  completedOn: removal.completedOn,
                  creditBatches,
                  badge: (
                    <SubmissionStatusBadge
                      latest={submission}
                      isLockedInFlight={
                        submission ? isLockedInFlight(submission) : false
                      }
                    />
                  ),
                }),
              )}
            />
          )}
        </section>

        <GhgStatementReportWorkflow
          ghgStatementId={statement.id}
          reportsQuery={reportsQuery}
          canGenerate={canGenerate}
          generationUnavailableReason={generationUnavailableReason}
        />

        {recentSyncEvents.length > 0 && (
          <SyncEventLog
            events={recentSyncEvents}
            compact
            label={`Submission history (${recentSyncEvents.length})`}
          />
        )}

        {blockedNote && (
          <p className="body-small text-[var(--color-text-tertiary)]">
            {blockedNote}
          </p>
        )}
      </SlideOverPanel.Body>

      <GhgStatementSubmitDialog
        ghgStatementId={statement.id}
        isOpen={submitOpen}
        onClose={() => setSubmitOpen(false)}
        isProduction={isProduction}
        isResubmit={isResubmit}
        approvedReportId={
          reportsQuery.data?.find(
            (report) =>
              report.lifecycle === "approved" ||
              report.lifecycle === "submitted",
          )?.id ?? null
        }
      />

      <SlideOverPanel.Footer className="justify-stretch">
        {statementSubmission && (
          <Button
            variant="default"
            className="flex-1"
            onClick={handleRefresh}
            busy={refreshMutation.isPending}
          >
            {!refreshMutation.isPending && (
              <ArrowsClockwiseIcon size={ICON_SIZE} />
            )}
            Refresh
          </Button>
        )}
        {canSubmit && (
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => setSubmitOpen(true)}
          >
            {isResubmit ? "Resubmit" : "Submit"}
          </Button>
        )}
        <SlideOverPanel.Close>
          <Button
            variant={canSubmit ? "default" : "primary"}
            className="flex-1"
          >
            Close
          </Button>
        </SlideOverPanel.Close>
      </SlideOverPanel.Footer>
    </>
  );
}

function CloseFooter() {
  return (
    <SlideOverPanel.Footer className="justify-stretch">
      <SlideOverPanel.Close>
        <Button variant="primary" className="flex-1">
          Close
        </Button>
      </SlideOverPanel.Close>
    </SlideOverPanel.Footer>
  );
}
