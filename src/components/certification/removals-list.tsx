/**
 * RemovalsList — the Certification → Removals workspace tab (route:
 * /certification/removals). The app-native DataTable idiom (cf. production-runs):
 * one dense, scannable list of every Removal for the selected facility. A row
 * opens a read-only quick view in a side-sheet (`?removal=<id>`, nuqs); the
 * sheet one-click-submits a ready 1:1 removal or routes complex ones to the
 * guided Review flow.
 *
 * Creating a removal is the "New removal" modal wizard (`NewRemovalDialog`,
 * design doc §4) — it replaces the old per-batch "Group into…" dropdown:
 * pick ready batches → continue (deferred create) → confirm & submit.
 *
 * Readiness is server-owned: rows come from `useCertificationOverview` (legacy
 * hook name, shared `deriveRemovalReadiness` classifier), so the table hint,
 * detail sheet, and wizard submit step can never disagree.
 */
"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import {
  PlusIcon,
  SealCheckIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { DataTable } from "@/components/ui/data-table";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useRemovalPreflightSummaries,
  useRemovalsForFacility,
} from "@/hooks/use-certification";
import { deriveRemovalWorkflowStatus } from "@/lib/certification/status";
import { formatDateRange } from "@/lib/format-utils";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { NewRemovalDialog } from "./new-removal-dialog";
import { RemovalDetailSheet } from "./removal-detail-sheet";
import {
  buildRemovalListRows,
  type RemovalListRow,
} from "./removal-list-state";

const SHORT_ID = 8;

export function RemovalsList() {
  const { facilityId, selectedFacility } = useFacilityContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  // Resume an existing draft removal in the wizard — the consolidated landing
  // for the retired `/[removalId]/review` route, which now redirects here with
  // `?resume=<removalId>` (design doc §4).
  const [resume, setResume] = useQueryState(
    "resume",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );

  const wizardOpen = dialogOpen || !!resume;
  const closeWizard = () => {
    setDialogOpen(false);
    void setResume(null);
  };

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="certification"
        title="Removals"
        subtitle="A Removal is the registry submission unit. Group one or more complete credit batches that share a reporting period, then submit the Removal to the registry."
        actions={
          facilityId ? (
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              <PlusIcon size={16} weight="bold" />
              New Removal
            </Button>
          ) : undefined
        }
      />

      {!facilityId ? (
        <EmptyState
          icon={<SealCheckIcon size={48} />}
          title="Select a facility"
          description="Choose a facility from the sidebar to view its Removals."
        />
      ) : (
        <ListBody facilityId={facilityId} onNewRemoval={() => setDialogOpen(true)} />
      )}

      {facilityId && (
        <NewRemovalDialog
          facilityId={facilityId}
          facilityName={
            selectedFacility?.name?.trim() ||
            selectedFacility?.code ||
            "Selected facility"
          }
          isOpen={wizardOpen}
          onClose={closeWizard}
          resumeRemovalId={resume}
        />
      )}
    </div>
  );
}

function shortId(id: string): string {
  return id.slice(0, SHORT_ID);
}

function reportingWindow(summary: RemovalListRow): string | null {
  return summary.startedOn && summary.completedOn
    ? formatDateRange(summary.startedOn, summary.completedOn)
    : null;
}

function RemovalCell({ summary }: { summary: RemovalListRow }) {
  const window = reportingWindow(summary);
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="body-small font-mono text-[var(--color-text-primary)] truncate">
        {shortId(summary.removalId)}…
      </span>
      {window && (
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {window}
        </span>
      )}
    </div>
  );
}

function MemberBatchesCell({ summary }: { summary: RemovalListRow }) {
  const { memberBatchCodes } = summary;
  if (memberBatchCodes.length === 0) {
    return (
      <span className="body-small text-[var(--color-text-tertiary)]">
        {MISSING_VALUE.none}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="body-small font-mono text-[var(--color-text-primary)] truncate">
        {memberBatchCodes.join(", ")}
      </span>
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {memberBatchCodes.length} batch
        {memberBatchCodes.length === 1 ? "" : "es"}
      </span>
    </div>
  );
}

function StatusCell({ summary }: { summary: RemovalListRow }) {
  const status = deriveRemovalWorkflowStatus({
    local: summary.local,
    lockInFlight: summary.lockInFlight,
    submissionInterrupted: summary.submissionInterrupted,
    enrichmentStatus: summary.enrichmentStatus,
    readiness: summary.readiness,
  });
  const firstReason = status.reasons[0];
  const remainingReasonCount = status.reasons.length - 1;

  return (
    <span className="flex flex-col items-start gap-4">
      <StatusBadge status={status.value} label={status.label} />
      {firstReason && (
        <span className="inline-flex items-start gap-6 body-caption text-[var(--color-text-secondary)]">
          <WarningIcon
            size={14}
            weight="fill"
            aria-hidden
            className="mt-px shrink-0 text-[var(--color-signal-orange)]"
          />
          <span className="line-clamp-2">
            {firstReason}
            {remainingReasonCount > 0 ? ` +${remainingReasonCount} more` : ""}
          </span>
        </span>
      )}
      {status.canRetry && (
        <Button
          variant="default"
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            void summary.retry?.();
          }}
        >
          Retry
        </Button>
      )}
    </span>
  );
}

const columns: ColumnDef<RemovalListRow>[] = [
  {
    id: "removal",
    header: "Removal",
    accessorFn: (summary) =>
      `${summary.removalId} ${reportingWindow(summary) ?? ""}`,
    cell: ({ row }) => <RemovalCell summary={row.original} />,
  },
  {
    id: "batches",
    header: "Credit batches",
    accessorFn: (summary) => summary.memberBatchCodes.join(" "),
    cell: ({ row }) => <MemberBatchesCell summary={row.original} />,
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (summary) => {
      const status = deriveRemovalWorkflowStatus({
        local: summary.local,
        lockInFlight: summary.lockInFlight,
        submissionInterrupted: summary.submissionInterrupted,
        enrichmentStatus: summary.enrichmentStatus,
        readiness: summary.readiness,
      });
      return `${status.label} ${status.reasons.join(" ")}`;
    },
    cell: ({ row }) => <StatusCell summary={row.original} />,
  },
];

function ListBody({
  facilityId,
  onNewRemoval,
}: {
  facilityId: string;
  onNewRemoval: () => void;
}) {
  const identities = useRemovalsForFacility(facilityId);
  const [searchQuery, setSearchQuery] = useState("");
  const [removalId, setRemovalId] = useQueryState(
    "removal",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );

  const identityRows = identities.data?.removals ?? [];
  const enrichmentByRemovalId = useRemovalPreflightSummaries(
    facilityId,
    identityRows.map((entry) => entry.removal.id),
  );

  if (identities.error) {
    return (
      <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <p className="body-medium text-[var(--clr-red)]" role="alert">
          Removals could not be loaded. Refresh the page and try again.
        </p>
      </div>
    );
  }

  const rows = buildRemovalListRows(identityRows, enrichmentByRemovalId);
  const selected = removalId
    ? rows.find((r) => r.removalId === removalId)
    : undefined;

  return (
    <>
      <section className="flex flex-col gap-16">
        <h2 className="title-heading-3">
          Removals{" "}
          <span className="body-small text-[var(--color-text-tertiary)]">
            ({rows.length})
          </span>
        </h2>
        <DataTable
          columns={columns}
          data={rows}
          enableFiltering
          enablePagination
          globalFilter={searchQuery}
          onGlobalFilterChange={setSearchQuery}
          isLoading={identities.isLoading}
          hoverable
          onRowClick={(row) => setRemovalId(row.removalId)}
          aria-label="Removals"
          emptyMessage={
            <EmptyState
              padding="md"
              icon={<SealCheckIcon size={40} />}
              title={searchQuery ? "No matching Removals" : "No Removals yet"}
              description={
                searchQuery
                  ? "Try clearing your search."
                  : "Group complete credit batches into a Removal to submit them."
              }
              action={
                searchQuery ? undefined : (
                  <Button variant="default" onClick={onNewRemoval}>
                    <PlusIcon size={16} weight="bold" />
                    Create your first Removal
                  </Button>
                )
              }
            />
          }
        >
          <DataTable.Toolbar>
            <DataTable.Search
              placeholder="Search Removals..."
              aria-label="Search Removals"
            />
            <DataTable.Controls>
              <DataTable.ColumnVisibility />
            </DataTable.Controls>
          </DataTable.Toolbar>
          <DataTable.Pagination />
        </DataTable>
      </section>

      {selected && identities.data && (
        <RemovalDetailSheet
          summary={selected}
          isProduction={identities.data.isProduction}
          facilityId={facilityId}
          open
          onClose={() => setRemovalId(null)}
        />
      )}
    </>
  );
}
