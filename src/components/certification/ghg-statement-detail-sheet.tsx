/**
 * GhgStatementDetailSheet — the read-only quick view for a GHG Statement,
 * opened from the Statements table via `?statement=<id>`. Shows the reporting
 * period, derived status, the registry record, the verifier (remote) status,
 * and the removals Isometric linked into it.
 *
 * Membership is strictly read-only here (ADR 0004): Isometric links removals to
 * the statement server-side by reporting-period date range, so there is no
 * UI to assign or detach a removal. The only actions are the two guided ones —
 * refresh the verifier status, and submit/resubmit to the verifier.
 *
 * Built on SlideOverPanel (like RemovalDetailSheet) rather than EntitySideSheet:
 * it's a read-only quick view with bespoke actions, not a view↔edit form.
 */
"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import {
  useGhgStatementState,
  useRefreshGhgStatementStatus,
} from "@/hooks/use-certification";
import type { GhgStatementListItem } from "@/fn/certification/ghg-statements";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import { chooseGhgSubmitMode } from "@/lib/isometric/utils/ghg-statement-state";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { EnvBanner } from "./env-banner";
import { GhgStatementSubmitDialog } from "./ghg-statement-submit-dialog";
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
  const { statement, latestSubmission, linkedRemovalCount } = item;
  const period = statementPeriod(item);
  const locked = latestSubmission ? isLockedInFlight(latestSubmission) : false;
  const derived = deriveSubmissionStatus(latestSubmission, locked, "ghgStatement");

  return (
    <SlideOverPanel.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <SlideOverPanel.Content size="default">
        <SlideOverPanel.Header showClose>
          <SlideOverPanel.Title>GHG Statement</SlideOverPanel.Title>
          <SlideOverPanel.Description>{period}</SlideOverPanel.Description>
        </SlideOverPanel.Header>

        <SlideOverPanel.Body className="flex flex-col gap-24">
          <EnvBanner isProduction={isProduction} variant="inline" />

          <div className="flex items-center justify-between gap-12">
            <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
              Status
            </span>
            <StatusBadge status={derived.value} label={derived.label} />
          </div>

          <Field label="Reporting period">{period}</Field>

          <Field label="Linked removals">{linkedRemovalCount}</Field>

          {latestSubmission?.externalId && (
            <Field label="Registry record">
              <span className="font-mono text-[var(--color-text-secondary)]">
                {latestSubmission.externalId} · v{latestSubmission.version}
              </span>
            </Field>
          )}

          <DetailState
            ghgStatementId={statement.id}
            isProduction={isProduction}
          />
        </SlideOverPanel.Body>

        <SlideOverPanel.Footer className="justify-end">
          <SlideOverPanel.Close>
            <Button variant="default">Close</Button>
          </SlideOverPanel.Close>
        </SlideOverPanel.Footer>
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}

// The verifier-lifecycle detail + actions. Split out so it owns the heavier
// `useGhgStatementState` fetch (remote status, linked removals, sync events),
// which only runs while one statement is selected — never per table row (P2-a).
function DetailState({
  ghgStatementId,
  isProduction,
}: {
  ghgStatementId: string;
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
  const canSubmit =
    Boolean(statementSubmission?.externalId) &&
    (mode === "submit" || mode === "resubmit");
  const isResubmit = mode === "resubmit";
  const blockedNote =
    mode === "blocked-awaiting"
      ? "Awaiting verification — no action needed."
      : mode === "blocked-verified"
        ? "Verified — no further submission."
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
      <Field label="Verifier status">
        {remote ? remote.status : "Not yet created in Isometric"}
      </Field>

      <div className="flex flex-col gap-8">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Linked removals ({linkedRemovals.length})
        </span>
        {linkedRemovals.length === 0 ? (
          <p className="body-small text-[var(--color-text-tertiary)]">
            No removals linked yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {linkedRemovals.map(({ removal, submission }) => (
              <li
                key={removal.id}
                className="flex items-center justify-between gap-8 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 py-8"
              >
                <span className="body-caption font-mono text-[var(--color-text-secondary)] truncate">
                  {submission?.externalId ?? `${removal.id.slice(0, SHORT_ID)}…`}
                </span>
                <SubmissionStatusBadge
                  latest={submission}
                  isLockedInFlight={
                    submission ? isLockedInFlight(submission) : false
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <SyncEventLog events={recentSyncEvents} compact />

      <div className="flex flex-col gap-12 border-t border-[var(--color-border-tertiary)] pt-16">
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
              {!refreshMutation.isPending && <ArrowsClockwise size={ICON_SIZE} />}
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
