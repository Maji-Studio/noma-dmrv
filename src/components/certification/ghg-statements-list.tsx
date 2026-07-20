/**
 * GhgStatementsList — the Certification → GHG Statements workspace tab (route:
 * /certification/ghg-statements). Replaces the card-grid GhgStatementsHub with
 * the app-native DataTable idiom (cf. removals-list / production-runs): one
 * dense, scannable list of every GHG Statement for the selected facility. A row
 * opens a read-only quick view in a side-sheet (`?statement=<id>`, nuqs); the
 * "New GHG Statement" button opens the period-first create drawer.
 *
 * A GHG Statement is an independent, period-anchored artifact that rolls up
 * multiple Removals (ADR 0003); Isometric decides membership server-side by
 * date range, so membership stays read-only here (ADR 0004).
 *
 * The status column derives from the persisted `metadata.remoteStatus` overlay
 * (`deriveSubmissionStatus(..., "ghgStatement")`) — NOT a per-row live verifier
 * fetch (P2-a, N+1). The selected statement's heavier detail (remote status,
 * sync events) loads once in the side-sheet.
 */
"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { ClipboardTextIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useFacilityCertifierSummary,
  useGhgStatementsForFacility,
} from "@/hooks/use-certification";
import type { GhgStatementListItem } from "@/fn/certification/ghg-statements";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { GhgStatementCreateDrawer } from "./ghg-statement-create-drawer";
import { GhgStatementDetailSheet } from "./ghg-statement-detail-sheet";

export function GhgStatementsList() {
  const { facilityId } = useFacilityContext();

  return (
    <div className="container-max page-shell">
      <header className="flex flex-col gap-8">
        <span className="title-chapter-title text-[var(--color-text-tertiary)]">
          Certification
        </span>
        <h1 className="title-heading-2">GHG Statements</h1>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          A GHG Statement covers a reporting period and rolls up every Removal
          Isometric links to it. Create one by picking the period end.
        </p>
      </header>

      {!facilityId ? (
        <EmptyState
          icon={<ClipboardTextIcon size={48} />}
          title="Select a facility"
          description="Choose a facility from the sidebar to view its GHG statements."
        />
      ) : (
        <ListBody facilityId={facilityId} />
      )}
    </div>
  );
}

function statementPeriod(item: GhgStatementListItem): {
  primary: string;
  secondary: string;
} {
  const { reportingPeriodStartOn, reportingPeriodEndOn } = item.statement;
  return reportingPeriodStartOn
    ? {
        primary: formatDateRange(reportingPeriodStartOn, reportingPeriodEndOn),
        secondary: "Reconciled period",
      }
    : {
        primary: `Ends ${formatDate(reportingPeriodEndOn)}`,
        secondary: "Period start pending",
      };
}

function PeriodCell({ item }: { item: GhgStatementListItem }) {
  const { primary, secondary } = statementPeriod(item);
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="body-small font-mono text-[var(--color-text-primary)] truncate">
        {primary}
      </span>
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {secondary}
      </span>
    </div>
  );
}

function LinkedRemovalsCell({ item }: { item: GhgStatementListItem }) {
  const { linkedRemovalCount } = item;
  return (
    <span className="body-small text-[var(--color-text-primary)]">
      {linkedRemovalCount}
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {" "}
        removal{linkedRemovalCount === 1 ? "" : "s"}
      </span>
    </span>
  );
}

function RegistryRecordCell({ item }: { item: GhgStatementListItem }) {
  const { latestSubmission } = item;
  if (!latestSubmission?.externalId) {
    return (
      <span className="body-small text-[var(--color-text-tertiary)]">—</span>
    );
  }
  return (
    <span className="body-small font-mono text-[var(--color-text-secondary)] truncate">
      {latestSubmission.externalId} · v{latestSubmission.version}
    </span>
  );
}

function StatusCell({ item }: { item: GhgStatementListItem }) {
  const { latestSubmission } = item;
  const locked = latestSubmission ? isLockedInFlight(latestSubmission) : false;
  const derived = deriveSubmissionStatus(latestSubmission, locked, "ghgStatement");
  return <StatusBadge status={derived.value} label={derived.label} />;
}

const columns: ColumnDef<GhgStatementListItem>[] = [
  {
    id: "period",
    header: "Reporting period",
    cell: ({ row }) => <PeriodCell item={row.original} />,
  },
  {
    id: "linkedRemovals",
    header: "Linked removals",
    cell: ({ row }) => <LinkedRemovalsCell item={row.original} />,
  },
  {
    id: "registry",
    header: "Registry record",
    cell: ({ row }) => <RegistryRecordCell item={row.original} />,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusCell item={row.original} />,
  },
];

function ListBody({ facilityId }: { facilityId: string }) {
  // DB-only summary — this page only needs link-presence + env. It must NOT pull
  // the management payload (available projects/templates, cross-facility link
  // hints, live Isometric API calls) that `useFacilityCertifierMapping` fetches.
  const summaryQuery = useFacilityCertifierSummary(facilityId);
  const query = useGhgStatementsForFacility(facilityId);
  const [createOpen, setCreateOpen] = useState(false);
  const [statementId, setStatementId] = useQueryState(
    "statement",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );

  const isProduction = summaryQuery.data?.isProduction ?? false;
  // Keep `isLinked` indeterminate (null) while the mapping lookup is in flight
  // so we don't flash the "not linked" notice or disable Create on first mount
  // before the query settles. Downstream gates on `=== true` / `=== false`.
  const isLinked = summaryQuery.isLoading
    ? null
    : Boolean(summaryQuery.data?.mapping);
  const mappingFailed = summaryQuery.isError && !summaryQuery.isLoading;

  if (query.error) {
    return (
      <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <p className="body-medium text-[var(--clr-red)]" role="alert">
          Unable to load GHG statements. Try refreshing the page.
        </p>
      </div>
    );
  }

  const statements = query.data ?? [];
  const selected = statementId
    ? statements.find((s) => s.statement.id === statementId)
    : undefined;

  return (
    <>
      <section className="flex flex-col gap-16">
        <div className="flex items-center justify-between gap-24">
          <h2 className="title-heading-3">
            Statements{" "}
            <span className="body-small text-[var(--color-text-tertiary)]">
              ({statements.length})
            </span>
          </h2>
          <Button
            variant="primary"
            onClick={() => setCreateOpen(true)}
            disabled={isLinked !== true}
          >
            <PlusIcon size={20} weight="bold" />
            New GHG Statement
          </Button>
        </div>

        {(mappingFailed || isLinked === false) && (
          <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-20 py-12">
            {mappingFailed ? (
              <p className="body-small text-[var(--clr-red)]">
                Couldn&apos;t verify the Isometric project link. Refresh the
                page to retry.
              </p>
            ) : (
              <p className="body-small text-[var(--color-text-secondary)]">
                Link this facility to an Isometric project (Settings → Registry
                connection) before creating a GHG statement.
              </p>
            )}
          </div>
        )}

        <DataTable
          columns={columns}
          data={statements}
          isLoading={query.isLoading}
          hoverable
          onRowClick={(row) => setStatementId(row.statement.id)}
          aria-label="GHG statements"
          emptyMessage={
            <div className="flex flex-col items-center justify-center gap-12 py-48">
              <ClipboardTextIcon
                size={40}
                className="text-[var(--color-text-tertiary)]"
              />
              <div className="text-center">
                <h3 className="title-heading-3 mb-1">No GHG statements yet</h3>
                <p className="body-small text-[var(--color-text-secondary)]">
                  Create one to roll up submitted removals for a reporting
                  period.
                </p>
              </div>
            </div>
          }
        />
      </section>

      {selected && (
        <GhgStatementDetailSheet
          item={selected}
          isProduction={isProduction}
          open
          onClose={() => setStatementId(null)}
        />
      )}

      {isLinked === true && (
        <GhgStatementCreateDrawer
          facilityId={facilityId}
          isProduction={isProduction}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </>
  );
}
