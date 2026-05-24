/**
 * GhgStatementsHub — the Isometric Certify GHG Statements management page
 * (route: /certification/ghg-statements). A GHG Statement is an independent,
 * period-anchored artifact that rolls up multiple Removals (ADR 0003).
 * Lists every statement for the selected facility, lets the user create one
 * period-first, submit it to the verifier, and refresh its status.
 */
"use client";

import { useState } from "react";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useFacilityCertifierMapping,
  useGhgStatementsForFacility,
  useGhgStatementState,
  useRefreshGhgStatementStatus,
} from "@/hooks/use-certification";
import type { GhgStatementListItem } from "@/fn/certification/ghg-statements";
import { chooseGhgSubmitMode } from "@/lib/isometric/utils/ghg-statement-state";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { GhgStatementCreateDialog } from "./ghg-statement-create-dialog";
import { GhgStatementSubmitDialog } from "./ghg-statement-submit-dialog";
import { SubmissionStatusBadge } from "./submission-status-badge";
import { SyncEventLog } from "./sync-event-log";

const ICON_SIZE = 14;

export function GhgStatementsHub() {
  const { facilityId } = useFacilityContext();

  return (
    <div className="flex flex-col gap-24 p-24">
      <header className="flex flex-col gap-4">
        <span className="title-chapter-title text-[var(--color-text-tertiary)]">
          Isometric Certify
        </span>
        <h1 className="title-heading-2">GHG Statements</h1>
        <p className="body-medium text-[var(--color-text-secondary)]">
          A GHG Statement covers a reporting period and rolls up every Removal
          Isometric links to it. Create one by picking the period end.
        </p>
      </header>

      {!facilityId ? (
        <p className="body-medium text-[var(--color-text-tertiary)]">
          Select a facility to view its GHG statements.
        </p>
      ) : (
        <HubBody facilityId={facilityId} />
      )}
    </div>
  );
}

function HubBody({ facilityId }: { facilityId: string }) {
  const mappingQuery = useFacilityCertifierMapping(facilityId);
  const query = useGhgStatementsForFacility(facilityId);
  const [createOpen, setCreateOpen] = useState(false);

  const isProduction = mappingQuery.data?.isProduction ?? false;
  const isLinked = Boolean(mappingQuery.data?.mapping);
  const mappingFailed = mappingQuery.isError;

  if (query.isLoading) {
    return (
      <p className="body-medium text-[var(--color-text-tertiary)]">
        Loading GHG statements…
      </p>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="body-medium text-[var(--clr-red)]">
        Unable to load GHG statements. Try refreshing the page.
      </p>
    );
  }

  const statements = query.data;

  return (
    <div className="flex flex-col gap-16">
      <div className="flex items-center justify-between gap-12">
        <h2 className="title-heading-3">
          Statements{" "}
          <span className="body-small text-[var(--color-text-tertiary)]">
            ({statements.length})
          </span>
        </h2>
        <Button
          variant="primary"
          size="small"
          onClick={() => setCreateOpen(true)}
          disabled={!isLinked}
        >
          New GHG Statement
        </Button>
      </div>

      {mappingFailed ? (
        <p className="body-small text-[var(--clr-red)]">
          Couldn&apos;t verify the Isometric project link. Refresh the page to
          retry.
        </p>
      ) : (
        !isLinked && (
          <p className="body-small text-[var(--color-text-tertiary)]">
            Link this facility to an Isometric project before creating a GHG
            statement.
          </p>
        )
      )}

      {statements.length === 0 ? (
        <p className="body-medium text-[var(--color-text-tertiary)]">
          No GHG statements yet. Create one to roll up submitted removals for a
          reporting period.
        </p>
      ) : (
        <div className="flex flex-col gap-16">
          {statements.map((item) => (
            <GhgStatementCard
              key={item.statement.id}
              item={item}
              isProduction={isProduction}
            />
          ))}
        </div>
      )}

      {isLinked && (
        <GhgStatementCreateDialog
          facilityId={facilityId}
          isProduction={isProduction}
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}

function GhgStatementCard({
  item,
  isProduction,
}: {
  item: GhgStatementListItem;
  isProduction: boolean;
}) {
  const { statement, latestSubmission, linkedRemovalCount } = item;
  const [expanded, setExpanded] = useState(false);
  const locked = latestSubmission ? isLockedInFlight(latestSubmission) : false;
  const headingId = `ghg-${statement.id}`;
  const period = statement.reportingPeriodStartOn
    ? `${statement.reportingPeriodStartOn} → ${statement.reportingPeriodEndOn}`
    : `Ends ${statement.reportingPeriodEndOn}`;

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20"
    >
      <div className="flex items-start justify-between gap-12">
        <div className="flex flex-col gap-2 min-w-0">
          <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            GHG Statement
          </span>
          <span
            id={headingId}
            className="body-small font-medium text-[var(--color-text-primary)]"
          >
            {period}
          </span>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {linkedRemovalCount} linked removal(s)
          </span>
        </div>
        <SubmissionStatusBadge
          latest={latestSubmission}
          isLockedInFlight={locked}
        />
      </div>

      {latestSubmission?.externalId && (
        <span className="body-caption font-mono text-[var(--color-text-tertiary)] truncate">
          {latestSubmission.externalId} · v{latestSubmission.version}
        </span>
      )}

      <div className="flex items-center justify-end border-t border-[var(--color-border-tertiary)] pt-12">
        <Button
          variant="default"
          size="small"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide details" : "View details"}
        </Button>
      </div>

      {expanded && (
        <StatementDetail
          ghgStatementId={statement.id}
          isProduction={isProduction}
        />
      )}
    </article>
  );
}

function StatementDetail({
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
        Loading details…
      </p>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="body-small text-[var(--clr-red)]">
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
      ? "Awaiting verification."
      : mode === "blocked-verified"
        ? "Verified."
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
    <div className="flex flex-col gap-12 border-t border-[var(--color-border-tertiary)] pt-12">
      <div className="flex flex-col gap-2">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Remote status
        </span>
        <span className="body-small text-[var(--color-text-secondary)]">
          {remote ? remote.status : "Not yet created in Isometric"}
        </span>
      </div>

      <div className="flex flex-col gap-4">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Linked removals ({linkedRemovals.length})
        </span>
        {linkedRemovals.length === 0 ? (
          <p className="body-caption text-[var(--color-text-tertiary)]">
            No removals linked yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {linkedRemovals.map(({ removal, submission }) => (
              <li
                key={removal.id}
                className="flex items-center justify-between gap-8 border border-[var(--color-border-secondary)] px-12 py-8"
              >
                <span className="body-caption font-mono text-[var(--color-text-secondary)] truncate">
                  {submission?.externalId ?? removal.id}
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

      <div className="flex items-center justify-end gap-8">
        {blockedNote && (
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {blockedNote}
          </span>
        )}
        {statementSubmission && (
          <Button
            variant="default"
            size="small"
            onClick={handleRefresh}
            disabled={refreshMutation.isPending}
          >
            {refreshMutation.isPending && (
              <ArrowsClockwise size={ICON_SIZE} className="animate-spin" />
            )}
            Refresh status
          </Button>
        )}
        {canSubmit && (
          <Button
            variant="primary"
            size="small"
            onClick={() => setSubmitOpen(true)}
          >
            {isResubmit ? "Resubmit" : "Submit to Verifier"}
          </Button>
        )}
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
