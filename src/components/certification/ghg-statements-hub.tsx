/**
 * GhgStatementsHub — the Isometric Certify GHG Statements management page
 * (route: /certification/ghg-statements). A GHG Statement is an independent,
 * period-anchored artifact that rolls up multiple Removals (ADR 0003).
 * Lists every statement for the selected facility, lets the user create one
 * period-first, submit it to the verifier, and refresh its status.
 */
"use client";

import { useState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  ClipboardText,
  LinkSimple,
  Plus,
} from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState } from "@/components/ui";
import { StatCard } from "@/components/dashboard/stat-card";
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
const STAT_ICON_SIZE = 24;

export function GhgStatementsHub() {
  const { facilityId } = useFacilityContext();

  return (
    <div className="container-max flex flex-col gap-32 py-32">
      <header className="flex flex-col gap-8">
        <span className="title-chapter-title text-[var(--color-text-tertiary)]">
          Isometric Certify
        </span>
        <h1 className="title-heading-2">GHG Statements</h1>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          A GHG Statement covers a reporting period and rolls up every Removal
          Isometric links to it. Create one by picking the period end.
        </p>
      </header>

      {!facilityId ? (
        <EmptyState
          icon={<ClipboardText size={48} />}
          title="Select a facility"
          description="Choose a facility from the sidebar to view its GHG statements."
        />
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
      <>
        <div className="grid grid-cols-1 gap-24 md:grid-cols-2 xl:grid-cols-3">
          <StatCard title="Statements" value="—" isLoading />
          <StatCard title="Submitted" value="—" isLoading />
          <StatCard title="Linked Removals" value="—" isLoading />
        </div>
        <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
          <p className="body-medium text-[var(--color-text-tertiary)]">
            Loading GHG statements…
          </p>
        </section>
      </>
    );
  }
  if (query.error || !query.data) {
    return (
      <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <p className="body-medium text-[var(--clr-red)]">
          Unable to load GHG statements. Try refreshing the page.
        </p>
      </div>
    );
  }

  const statements = query.data;
  const submittedCount = statements.filter(
    (s) => s.latestSubmission?.externalId,
  ).length;
  const linkedRemovalsTotal = statements.reduce(
    (sum, s) => sum + s.linkedRemovalCount,
    0,
  );

  return (
    <>
      <div className="flex items-center justify-between gap-24">
        <h2 className="title-heading-3">Overview</h2>
        <Button
          variant="primary"
          onClick={() => setCreateOpen(true)}
          disabled={!isLinked}
        >
          <Plus size={20} weight="bold" />
          New GHG Statement
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-24 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="Statements"
          value={statements.length}
          icon={<ClipboardText size={STAT_ICON_SIZE} weight="bold" />}
          description="Total GHG statements for this facility"
        />
        <StatCard
          title="Submitted"
          value={submittedCount}
          icon={<CheckCircle size={STAT_ICON_SIZE} weight="bold" />}
          description="Sent to the verifier at least once"
        />
        <StatCard
          title="Linked Removals"
          value={linkedRemovalsTotal}
          icon={<LinkSimple size={STAT_ICON_SIZE} weight="bold" />}
          description="Across all statements"
        />
      </div>

      {(mappingFailed || !isLinked) && (
        <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
          {mappingFailed ? (
            <p className="body-small text-[var(--clr-red)]">
              Couldn&apos;t verify the Isometric project link. Refresh the page
              to retry.
            </p>
          ) : (
            <p className="body-small text-[var(--color-text-secondary)]">
              Link this facility to an Isometric project before creating a GHG
              statement.
            </p>
          )}
        </div>
      )}

      <section className="flex flex-col gap-16">
        <h2 className="title-heading-3">
          Statements{" "}
          <span className="body-small text-[var(--color-text-tertiary)]">
            ({statements.length})
          </span>
        </h2>

        {statements.length === 0 ? (
          <EmptyState
            icon={<ClipboardText size={48} />}
            title="No GHG statements yet"
            description="Create one to roll up submitted removals for a reporting period."
            action={
              isLinked ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus size={20} weight="bold" />
                  New GHG Statement
                </Button>
              ) : undefined
            }
          />
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
      </section>

      {isLinked && (
        <GhgStatementCreateDialog
          facilityId={facilityId}
          isProduction={isProduction}
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </>
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
      className="flex flex-col bg-[var(--color-background-white)] border border-[var(--color-border-secondary)] transition-colors hover:border-[var(--color-border-primary)]"
    >
      <div className="flex flex-1 flex-col gap-16 p-20">
        <div className="flex items-start justify-between gap-12">
          <div className="flex flex-col gap-4 min-w-0">
            <span className="title-chapter-title text-[var(--color-text-tertiary)]">
              GHG Statement
            </span>
            <span
              id={headingId}
              className="title-heading-3 text-[var(--color-text-primary)]"
            >
              {period}
            </span>
          </div>
          <SubmissionStatusBadge
            latest={latestSubmission}
            isLockedInFlight={locked}
          />
        </div>

        <div className="grid grid-cols-2 gap-12">
          <div className="flex flex-col gap-4">
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Linked removals
            </span>
            <span className="body-small text-[var(--color-text-primary)]">
              {linkedRemovalCount}
            </span>
          </div>
          {latestSubmission?.externalId && (
            <div className="flex flex-col gap-4">
              <span className="body-caption text-[var(--color-text-tertiary)]">
                External ID
              </span>
              <span className="body-small font-mono text-[var(--color-text-primary)] truncate">
                {latestSubmission.externalId} · v{latestSubmission.version}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end border-t border-[var(--color-border-tertiary)] px-20 py-12">
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
      <div className="border-t border-[var(--color-border-tertiary)] px-20 py-16">
        <p
          aria-busy="true"
          className="body-small text-[var(--color-text-tertiary)]"
        >
          Loading details…
        </p>
      </div>
    );
  }
  if (query.error || !query.data) {
    return (
      <div className="border-t border-[var(--color-border-tertiary)] px-20 py-16">
        <p className="body-small text-[var(--clr-red)]">
          Unable to load statement details.
        </p>
      </div>
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
    <div className="flex flex-col gap-16 border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-light)] px-20 py-16">
      <div className="grid grid-cols-1 gap-16 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <span className="title-chapter-title text-[var(--color-text-tertiary)]">
            Remote status
          </span>
          <span className="body-small text-[var(--color-text-primary)]">
            {remote ? remote.status : "Not yet created in Isometric"}
          </span>
        </div>
        <div className="flex flex-col gap-4">
          <span className="title-chapter-title text-[var(--color-text-tertiary)]">
            Linked removals ({linkedRemovals.length})
          </span>
          {linkedRemovals.length === 0 ? (
            <span className="body-small text-[var(--color-text-tertiary)]">
              No removals linked yet.
            </span>
          ) : (
            <ul className="flex flex-col gap-4 mt-4">
              {linkedRemovals.map(({ removal, submission }) => (
                <li
                  key={removal.id}
                  className="flex items-center justify-between gap-8 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 py-8"
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
      </div>

      <SyncEventLog events={recentSyncEvents} compact />

      <div className="flex items-center justify-end gap-8 border-t border-[var(--color-border-tertiary)] pt-12">
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
