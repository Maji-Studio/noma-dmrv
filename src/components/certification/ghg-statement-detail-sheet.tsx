/**
 * GhgStatementDetailSheet — the read-only quick view for a GHG Statement,
 * opened from the Statements table via `?statement=<id>`. Shows the reporting
 * period, derived status, the registry record, the verifier (remote) status,
 * and the removals Isometric linked into it (as a cross-link accordion).
 *
 * It's a Modal, not a side-sheet: there's no form here — only read-only fields
 * plus the two guided actions (refresh status, submit/resubmit). Side-sheets in
 * this app are reserved for forms (the create flow, entity edit); a read-only
 * view belongs in a centred dialog.
 *
 * Membership is read-only (ADR 0004): Isometric links removals to the statement
 * server-side by reporting-period date range, so there is no UI to assign or
 * detach a removal. To change what a statement contains, open a linked removal
 * (via the accordion), edit it, and resubmit — there is no undo/withdraw.
 */
"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, Modal } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import {
  useGhgStatementState,
  useRefreshGhgStatementStatus,
} from "@/hooks/use-certification";
import type { GhgStatementListItem } from "@/fn/certification/ghg-statements";
import type { GhgStatement } from "@/lib/isometric";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import { chooseGhgSubmitMode } from "@/lib/isometric/utils/ghg-statement-state";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { EnvBanner } from "./env-banner";
import { GhgStatementCarbonBreakdown } from "./ghg-statement-carbon-breakdown";
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
  const { reportingPeriodStartOn, reportingPeriodEndOn } = item.statement;
  return reportingPeriodStartOn
    ? `${reportingPeriodStartOn} → ${reportingPeriodEndOn}`
    : `Ends ${reportingPeriodEndOn}`;
}

// Friendly one-line phrase for the raw registry verifier status. The raw enum
// ("DRAFT") next to a top badge reading "In registry" is the exact #250
// collision — DRAFT here means "created in the registry, not yet sent to the
// verifier", not the operator's mental "draft".
function verifierStatusLabel(remote: GhgStatement | null): string {
  if (!remote) return "Not yet created in Isometric";
  switch (remote.status) {
    case "DRAFT":
      return "In registry — not yet sent to the verifier";
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
      <div className="body-small text-[var(--color-text-primary)]">{children}</div>
    </div>
  );
}

export function GhgStatementDetailSheet({
  item,
  isProduction,
  open,
  onClose,
}: GhgStatementDetailSheetProps) {
  const { statement, latestSubmission } = item;
  const period = statementPeriod(item);
  const locked = latestSubmission ? isLockedInFlight(latestSubmission) : false;
  const derived = deriveSubmissionStatus(latestSubmission, locked, "ghgStatement");

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      ariaLabelledBy="ghg-detail-title"
      width="lg"
    >
      <div className="flex flex-col gap-24">
        <header className="flex flex-col gap-4">
          <h2 id="ghg-detail-title" className="title-heading-3">
            GHG Statement
          </h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            {period}
          </p>
        </header>

        <EnvBanner isProduction={isProduction} variant="inline" />

        <div className="flex items-center justify-between gap-12">
          <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Status
          </span>
          <StatusBadge status={derived.value} label={derived.label} />
        </div>

        <GhgStatementCarbonBreakdown
          ghgStatementId={statement.id}
          enabled={open}
        />

        <Field label="Reporting period">{period}</Field>

        {latestSubmission?.externalId && (
          <Field label="Registry record">
            <RegistryRecordLink
              facilityId={statement.facilityId}
              externalId={latestSubmission.externalId}
              version={latestSubmission.version}
              isProduction={isProduction}
              kind="ghgStatement"
            />
          </Field>
        )}

        <DetailState
          ghgStatementId={statement.id}
          facilityId={statement.facilityId}
          isProduction={isProduction}
        />

        <div className="flex justify-end border-t border-[var(--color-border-tertiary)] pt-16">
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// The verifier-lifecycle detail + actions. Split out so it owns the heavier
// `useGhgStatementState` fetch (remote status, linked removals, sync events),
// which only runs while one statement is selected — never per table row (P2-a).
function DetailState({
  ghgStatementId,
  facilityId,
  isProduction,
}: {
  ghgStatementId: string;
  facilityId: string;
  isProduction: boolean;
}) {
  const query = useGhgStatementState(ghgStatementId);
  const refreshMutation = useRefreshGhgStatementStatus();
  const toast = useToast();
  const [submitOpen, setSubmitOpen] = useState(false);

  if (query.isLoading) {
    return (
      <p
        aria-busy="true"
        className="body-small text-[var(--color-text-tertiary)]"
      >
        Loading verifier status…
      </p>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="body-small text-[var(--clr-red)]" role="alert">
        Unable to load statement details.
      </p>
    );
  }

  const { statementSubmission, linkedRemovals, remote, recentSyncEvents } =
    query.data;
  const mode = remote ? chooseGhgSubmitMode(remote) : "submit";
  // Never offer "Submit to verifier" on a 0-removal statement (#245) — the
  // server rejects it, and the button on an empty statement is exactly the
  // dead-end the redesign kills. Membership is authoritative here (reconciled
  // from the registry's `ghg_entry_ids`).
  const hasLinkedRemovals = linkedRemovals.length > 0;
  const canSubmit =
    Boolean(statementSubmission?.externalId) &&
    (mode === "submit" || mode === "resubmit") &&
    hasLinkedRemovals;
  const isResubmit = mode === "resubmit";
  const blockedNote =
    mode === "blocked-awaiting"
      ? "In verification — no action needed."
      : mode === "blocked-verified"
        ? "Verified — no further submission."
        : (mode === "submit" || mode === "resubmit") && !hasLinkedRemovals
          ? "No linked removals yet — there's nothing to submit. Add a removal in this reporting period, then refresh."
          : null;

  const handleRefresh = () => {
    if (!statementSubmission) return;
    refreshMutation.mutate(statementSubmission.id, {
      onSuccess: (r) => toast.success(`Status: ${r.status}.`),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Refresh failed."),
    });
  };

  return (
    <div className="flex flex-col gap-20 border-t border-[var(--color-border-tertiary)] pt-20">
      <Field label="Verifier status">{verifierStatusLabel(remote)}</Field>

      <div className="flex flex-col gap-8">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Linked removals ({linkedRemovals.length})
        </span>
        {linkedRemovals.length === 0 ? (
          <p className="body-small text-[var(--color-text-tertiary)]">
            No removals linked yet.
          </p>
        ) : (
          <RemovalBatchesAccordion
            facilityId={facilityId}
            entries={linkedRemovals.map(({ removal, submission, creditBatches }) => ({
              removalId: removal.id,
              label: submission?.externalId ?? `${removal.id.slice(0, SHORT_ID)}…`,
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
            }))}
          />
        )}
      </div>

      <SyncEventLog events={recentSyncEvents} compact />

      <div className="flex flex-col gap-12 border-t border-[var(--color-border-tertiary)] pt-16">
        {/* No undo/withdraw exists for a submitted statement. The supported
            path is amend-and-resubmit: edit a linked removal (open it above),
            then resubmit a new version — membership itself stays server-derived
            by date range (ADR 0004). */}
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Statements can&apos;t be withdrawn. To change what&apos;s included,
          open a removal above, edit it, then resubmit — pending changes are
          flagged here.
        </p>
        {blockedNote && (
          <p className="body-caption text-[var(--color-text-tertiary)]">
            {blockedNote}
          </p>
        )}
        <div className="flex items-center justify-end gap-8">
          {statementSubmission && (
            <Button
              variant="default"
              size="small"
              onClick={handleRefresh}
              busy={refreshMutation.isPending}
            >
              {!refreshMutation.isPending && <ArrowsClockwiseIcon size={ICON_SIZE} />}
              Refresh status
            </Button>
          )}
          {canSubmit && (
            <Button
              variant="primary"
              size="small"
              onClick={() => setSubmitOpen(true)}
            >
              {isResubmit ? "Resubmit" : "Submit to verifier"}
            </Button>
          )}
        </div>
      </div>

      <GhgStatementSubmitDialog
        ghgStatementId={ghgStatementId}
        isOpen={submitOpen}
        onClose={() => setSubmitOpen(false)}
        isProduction={isProduction}
        isResubmit={isResubmit}
      />
    </div>
  );
}
