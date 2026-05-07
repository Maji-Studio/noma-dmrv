"use client";

import { ArrowClockwise, Plus, SealCheck } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui";
import { ServerError } from "@/components/forms";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useFacilityCertificationOverview,
  useRefreshGhgStatementStatus,
} from "@/hooks/use-certification";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { isometricDocs } from "@/lib/isometric";
import { GhgStatementCreateDialog } from "./ghg-statement-create-dialog";
import { GhgStatementSubmitDialog } from "./ghg-statement-submit-dialog";
import { SubmissionStatusBadge } from "./submission-status-badge";

type StatementRow = NonNullable<
  ReturnType<typeof useFacilityCertificationOverview>["data"]
>["statementsForProject"][number];

export function CertificationPage() {
  const { facilityId, selectedFacility, isLoading: facilityLoading } =
    useFacilityContext();
  const [createOpen, setCreateOpen] = useState(false);
  const [submitTarget, setSubmitTarget] = useState<{
    submissionId: string;
    isResubmit: boolean;
  } | null>(null);

  const overview = useFacilityCertificationOverview(
    facilityId ?? "",
    !!facilityId,
  );

  if (facilityLoading || overview.isLoading) {
    return (
      <main className="p-24">
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading certification...
        </p>
      </main>
    );
  }

  if (!facilityId || !selectedFacility) {
    return (
      <main className="p-24">
        <ServerError message="Select a facility to view certification." />
      </main>
    );
  }

  if (overview.error || !overview.data) {
    return (
      <main className="p-24">
        <ServerError
          message={
            overview.error instanceof Error
              ? overview.error.message
              : "Unable to load certification."
          }
        />
      </main>
    );
  }

  const data = overview.data;
  const activeStatement = data.statementsForProject[0] ?? null;
  const activeStatus = activeStatement
    ? getRemoteStatus(activeStatement)
    : null;
  const activePending = activeStatement
    ? getPendingTotal(activeStatement)
    : null;
  const canSubmit = activeStatement && activeStatus === "DRAFT";
  const canResubmit =
    activeStatement &&
    (activeStatus === "FAILED_VERIFICATION" || activePending !== null);

  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="max-w-[1180px] mx-auto p-24 flex flex-col gap-24">
        <header className="flex items-center justify-between gap-16">
          <div className="flex items-center gap-12 min-w-0">
            <SealCheck size={28} className="shrink-0 text-[var(--clr-pink)]" />
            <div className="min-w-0">
              <h1 className="title-heading-2 truncate">Certification</h1>
              <p className="body-small text-[var(--color-text-tertiary)] truncate">
                {data.facility.code} · {data.facility.name}
              </p>
            </div>
          </div>
          {data.mapping && (
            <Button
              variant="primary"
              onClick={() => setCreateOpen(true)}
              className="shrink-0"
            >
              <Plus size={16} />
              Create GHG Statement
            </Button>
          )}
        </header>

        <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
          <div className="flex items-start justify-between gap-16">
            <div>
              <h2 className="title-heading-3">Isometric Project</h2>
              {data.mapping ? (
                <p className="body-small text-[var(--color-text-secondary)] mt-4">
                  {data.project?.name ?? data.mapping.externalProjectId}
                </p>
              ) : (
                <p className="body-small text-[var(--color-text-secondary)] mt-4">
                  This facility is not linked to an Isometric project.
                </p>
              )}
            </div>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              {data.isProduction ? "production" : "sandbox"}
            </span>
          </div>
        </section>

        {data.mapping ? (
          <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20 flex flex-col gap-18">
            <div className="flex items-start justify-between gap-16">
              <div>
                <div className="flex items-baseline gap-12">
                  <h2 className="title-heading-3">GHG Statement</h2>
                  <a
                    href={isometricDocs.ghgStatements}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
                  >
                    View GHG statement guide ↗
                  </a>
                </div>
                {activeStatement ? (
                  <p className="body-small text-[var(--color-text-secondary)] mt-4">
                    Period ending {activeStatement.period.reportingPeriodEndAt}
                  </p>
                ) : (
                  <p className="body-small text-[var(--color-text-secondary)] mt-4">
                    No GHG statement has been created for this project.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-10">
                {activeStatement?.submission.externalId && (
                  <StatementRefresh
                    row={activeStatement}
                    onRefreshed={() => void overview.refetch()}
                  />
                )}
                {canSubmit && (
                  <Button
                    variant="primary"
                    onClick={() =>
                      setSubmitTarget({
                        submissionId: activeStatement.submission.id,
                        isResubmit: false,
                      })
                    }
                  >
                    Submit to Verifier
                  </Button>
                )}
                {canResubmit && (
                  <Button
                    variant="primary"
                    onClick={() =>
                      setSubmitTarget({
                        submissionId: activeStatement.submission.id,
                        isResubmit: true,
                      })
                    }
                  >
                    Resubmit
                  </Button>
                )}
              </div>
            </div>

            {activePending !== null && (
              <div className="border border-[var(--color-signal-orange)] px-14 py-12 text-[var(--color-signal-orange)] body-small">
                Re-verification needed; pending net CO2e:{" "}
                {Number(activePending).toLocaleString()} kg
              </div>
            )}

            {activeStatement ? (
              <StatementList rows={data.statementsForProject} />
            ) : (
              <Button
                variant="default"
                className="self-start"
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={16} />
                Create GHG Statement
              </Button>
            )}
          </section>
        ) : (
          <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
            <p className="body-small text-[var(--color-text-secondary)]">
              Link the facility from facility settings before creating GHG
              statements.
            </p>
          </section>
        )}

        <RecentRemovals rows={data.recentRemovals} />
      </div>

      <GhgStatementCreateDialog
        facilityId={facilityId}
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        isProduction={data.isProduction}
      />
      {submitTarget && (
        <GhgStatementSubmitDialog
          facilityId={facilityId}
          submissionId={submitTarget.submissionId}
          isOpen={!!submitTarget}
          onClose={() => setSubmitTarget(null)}
          isProduction={data.isProduction}
          isResubmit={submitTarget.isResubmit}
        />
      )}
    </main>
  );
}

function StatementList({ rows }: { rows: StatementRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left body-caption text-[var(--color-text-tertiary)] border-b border-[var(--color-border-secondary)]">
            <th className="py-8 pr-12 font-medium">Period end</th>
            <th className="py-8 pr-12 font-medium">Remote status</th>
            <th className="py-8 pr-12 font-medium">Local status</th>
            <th className="py-8 pr-12 font-medium">External ID</th>
            <th className="py-8 pr-12 font-medium">Removals</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.submission.id}
              className="border-b border-[var(--color-border-tertiary)] body-small"
            >
              <td className="py-10 pr-12">{row.period.reportingPeriodEndAt}</td>
              <td className="py-10 pr-12">
                <RemoteStatusLabel status={getRemoteStatus(row)} />
              </td>
              <td className="py-10 pr-12">
                <SubmissionStatusBadge
                  latest={row.submission}
                  isLockedInFlight={isLockedInFlight(row.submission)}
                />
              </td>
              <td className="py-10 pr-12 font-mono body-caption">
                {row.submission.externalId ?? "-"}
              </td>
              <td className="py-10 pr-12">
                {row.remote?.removal_ids.length ?? getRemovalIds(row).length}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatementRefresh({
  row,
  onRefreshed,
}: {
  row: StatementRow;
  onRefreshed: () => void;
}) {
  const isInFlight = ["DRAFT", "AWAITING_VERIFICATION"].includes(
    getRemoteStatus(row) ?? "",
  );
  const refresh = useRefreshGhgStatementStatus(row.submission.id, {
    enabled: !!row.submission.externalId,
    isInFlight,
  });

  return (
    <Button
      variant="default"
      onClick={() => {
        void refresh.refetch().then(onRefreshed);
      }}
      disabled={refresh.isFetching}
      aria-label="Refresh GHG statement status"
    >
      <ArrowClockwise size={16} />
      {refresh.isFetching ? "Refreshing" : "Refresh"}
    </Button>
  );
}

function RecentRemovals({ rows }: { rows: CertificationSubmissionRow[] }) {
  return (
    <section className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20 flex flex-col gap-16">
      <h2 className="title-heading-3">Recent Removal Submissions</h2>
      {rows.length === 0 ? (
        <p className="body-small text-[var(--color-text-secondary)]">
          No recent removal submissions for this facility.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left body-caption text-[var(--color-text-tertiary)] border-b border-[var(--color-border-secondary)]">
                <th className="py-8 pr-12 font-medium">Status</th>
                <th className="py-8 pr-12 font-medium">External ID</th>
                <th className="py-8 pr-12 font-medium">Version</th>
                <th className="py-8 pr-12 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--color-border-tertiary)] body-small"
                >
                  <td className="py-10 pr-12">
                    <SubmissionStatusBadge
                      latest={row}
                      isLockedInFlight={isLockedInFlight(row)}
                    />
                  </td>
                  <td className="py-10 pr-12 font-mono body-caption">
                    {row.externalId ?? "-"}
                  </td>
                  <td className="py-10 pr-12">v{row.version}</td>
                  <td className="py-10 pr-12">
                    {row.submittedAt
                      ? new Date(row.submittedAt).toLocaleDateString()
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RemoteStatusLabel({ status }: { status: string | null }) {
  return (
    <span className="body-caption uppercase text-[var(--color-text-secondary)]">
      {status ?? "unknown"}
    </span>
  );
}

function getRemoteStatus(row: StatementRow): string | null {
  const metadataStatus = getMetadataValue(row.submission, "remoteStatus");
  return row.remote?.status ?? (typeof metadataStatus === "string" ? metadataStatus : null);
}

function getPendingTotal(row: StatementRow): number | null {
  const value = row.remote
    ? row.remote.pending_total_co2e_removed_kg
    : getMetadataValue(row.submission, "pendingTotalCo2eRemovedKg");
  return typeof value === "number" ? value : null;
}

function getRemovalIds(row: StatementRow): string[] {
  const value = getMetadataValue(row.submission, "removalIds");
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function getMetadataValue(
  submission: CertificationSubmissionRow,
  key: string,
): unknown {
  if (
    typeof submission.metadata === "object" &&
    submission.metadata !== null &&
    key in submission.metadata
  ) {
    return (submission.metadata as Record<string, unknown>)[key];
  }
  return null;
}

function isLockedInFlight(row: CertificationSubmissionRow): boolean {
  const lockedAtMs = row.lockedAt?.getTime() ?? 0;
  return (
    row.status === "draft" &&
    Date.now() - lockedAtMs < LOCK_TTL_MS
  );
}
