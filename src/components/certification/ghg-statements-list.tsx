/**
 * GhgStatementsList — the Certification → GHG Statements workspace tab (route:
 * /certification/ghg-statements). Replaces the card-grid GhgStatementsHub with
 * the app-native DataTable idiom (cf. removals-list / production-runs): one
 * dense, scannable list of every GHG Statement for the selected facility. A row
 * opens a read-only centered Modal (`?statement=<id>`, nuqs); the
 * "New GHG Statement" button opens the period-first create dialog.
 *
 * A GHG Statement is an independent, period-anchored artifact that rolls up
 * multiple Removals (ADR 0003); Isometric decides membership server-side by
 * date range, so membership stays read-only here (ADR 0004).
 *
 * The status column derives from the persisted `metadata.remoteStatus` overlay
 * (`deriveSubmissionStatus(..., "ghgStatement")`) — NOT a per-row live verifier
 * fetch (P2-a, N+1). The selected statement's heavier detail (remote status,
 * sync events) loads once in the detail Modal.
 */
"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import {
  ArrowsClockwiseIcon,
  ClipboardTextIcon,
  PlusIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useFacilityCertifierSummary,
  useGhgStatementsForFacility,
  useSyncGhgStatementsFromRegistry,
} from "@/hooks/use-certification";
import { useToast } from "@/components/ui/toast";
import type { GhgStatementListItem } from "@/fn/certification/ghg-statements";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import { certificationSettingsHref } from "@/lib/certification/links";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { formatCount } from "@/lib/copy-utils";
import { GhgStatementCreateDialog } from "./ghg-statement-create-dialog";
import { GhgStatementDetailSheet } from "./ghg-statement-detail-sheet";

// Which blocking notice (if any) the list shows above the table. Precedence:
// a failed summary beats everything, an unlinked facility beats the
// shared-project notice. Null while loading so nothing flashes before the
// summary settles.
export type GhgCreateGateNotice =
  | "mappingFailed"
  | "unlinked"
  | "sharedProject"
  | null;

export interface GhgCreateGate {
  canSync: boolean;
  canCreate: boolean;
  notice: GhgCreateGateNotice;
}

// Pure derivation of the Sync/Create button gating from the certifier summary
// query state. Create is additionally blocked when the Isometric project is
// shared by more than one noma facility: a GHG Statement is project-wide, so
// the server rejects creation late in the wizard; this gate surfaces that
// before the operator starts (`assertDedicatedGhgStatementProject` stays the
// authoritative backstop).
export function deriveGhgCreateGate(summary: {
  isLoading: boolean;
  isError: boolean;
  hasMapping: boolean;
  linkedFacilityCount: number | undefined;
}): GhgCreateGate {
  // Keep the link state indeterminate while the lookup is in flight so we do
  // not flash the "not linked" notice or enable Create before it settles.
  const isLinked = summary.isLoading ? null : summary.hasMapping;
  // A missing count stays indeterminate (fail closed) rather than defaulting
  // to dedicated: a stale cached payload without the field must not enable
  // Create on a shared project.
  const isDedicatedProject =
    summary.isLoading || summary.linkedFacilityCount === undefined
      ? null
      : summary.linkedFacilityCount <= 1;
  const mappingFailed = summary.isError && !summary.isLoading;
  return {
    // Fail closed on a failed summary even when React Query still holds cached
    // data from an earlier success: the cached mapping/count may be stale, and
    // enabling Create against it reintroduces the late server rejection this
    // gate exists to prevent.
    canSync: !mappingFailed && isLinked === true,
    canCreate:
      !mappingFailed && isLinked === true && isDedicatedProject === true,
    notice: mappingFailed
      ? "mappingFailed"
      : isLinked === false
        ? "unlinked"
        : isDedicatedProject === false
          ? "sharedProject"
          : null,
  };
}

export function CreateGateNotice({
  notice,
  facilityId,
  linkedFacilityCount,
}: {
  notice: GhgCreateGateNotice;
  facilityId: string;
  linkedFacilityCount: number | undefined;
}) {
  if (!notice) return null;
  return (
    <div className="border-l-2 border-[var(--color-signal-orange)] bg-[var(--color-signal-orange-light)] px-12 py-8">
      {notice === "mappingFailed" ? (
        <p className="body-small text-[var(--color-signal-orange-strong)]">
          Isometric project link unavailable. Refresh to retry.
        </p>
      ) : notice === "unlinked" ? (
        <p className="body-small text-[var(--color-signal-orange-strong)]">
          Link this facility to an Isometric project in Settings before creating
          a statement.
        </p>
      ) : (
        <p className="body-small text-[var(--color-signal-orange-strong)]">
          This Isometric project is linked to {linkedFacilityCount} noma
          facilities. A GHG Statement covers every facility on the project. Link
          each facility to a dedicated Isometric project in{" "}
          <Link
            href={certificationSettingsHref(facilityId)}
            className="text-[var(--color-interaction)] underline underline-offset-2 hover:text-[var(--color-interaction-hover)]"
          >
            Settings
          </Link>{" "}
          before creating a statement.
        </p>
      )}
    </div>
  );
}

export function GhgStatementsList() {
  const { facilityId } = useFacilityContext();

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="certification"
        title="GHG Statements"
        subtitle="Reporting periods and the Removals Isometric links to each."
      />

      {!facilityId ? (
        <EmptyState
          icon={<ClipboardTextIcon size={48} />}
          title="Select a facility"
          description="Select a facility to view its GHG Statements."
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
  const { reportingPeriodStartOn } = item.statement;
  const reportingPeriodEndOn = item.effectiveReportingPeriodEndOn;
  if (item.remotePeriodMissing) {
    return {
      primary: "No period set",
      secondary: "Registry period is missing",
    };
  }
  return reportingPeriodStartOn
    ? {
        primary: formatDateRange(reportingPeriodStartOn, reportingPeriodEndOn),
        secondary: "Reconciled period",
      }
    : {
        primary: `Ends ${formatDate(reportingPeriodEndOn)}`,
        secondary: "Start set by Isometric",
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
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {formatCount(linkedRemovalCount, "Removal")}
      </span>
    </span>
  );
}

function RegistryRecordCell({ item }: { item: GhgStatementListItem }) {
  const { latestSubmission } = item;
  if (!latestSubmission?.externalId) {
    return (
      <span className="body-small text-[var(--color-text-tertiary)]">None</span>
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
    accessorFn: (item) => statementPeriod(item).primary,
    cell: ({ row }) => <PeriodCell item={row.original} />,
  },
  {
    id: "linkedRemovals",
    header: "Linked Removals",
    accessorFn: (item) => String(item.linkedRemovalCount),
    cell: ({ row }) => <LinkedRemovalsCell item={row.original} />,
  },
  {
    id: "registry",
    header: "Registry record",
    accessorFn: (item) => item.latestSubmission?.externalId ?? "",
    cell: ({ row }) => <RegistryRecordCell item={row.original} />,
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (item) => {
      const submission = item.latestSubmission;
      return deriveSubmissionStatus(
        submission,
        submission ? isLockedInFlight(submission) : false,
        "ghgStatement",
      ).label;
    },
    cell: ({ row }) => <StatusCell item={row.original} />,
  },
];

function ListBody({ facilityId }: { facilityId: string }) {
  // DB-only summary — this page only needs link-presence + env. It must NOT pull
  // the management payload (available projects/templates, cross-facility link
  // hints, live Isometric API calls) that `useFacilityCertifierMapping` fetches.
  const summaryQuery = useFacilityCertifierSummary(facilityId);
  const query = useGhgStatementsForFacility(facilityId);
  const syncMutation = useSyncGhgStatementsFromRegistry();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statementId, setStatementId] = useQueryState(
    "statement",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );

  const isProduction = summaryQuery.data?.isProduction ?? false;
  const gate = deriveGhgCreateGate({
    isLoading: summaryQuery.isLoading,
    isError: summaryQuery.isError,
    hasMapping: Boolean(summaryQuery.data?.mapping),
    linkedFacilityCount: summaryQuery.data?.linkedFacilityCount,
  });
  const syncFromRegistry = async () => {
    try {
      const result = await syncMutation.mutateAsync(facilityId);
      // Report skips and warnings, not just successes: without them
      // "Synced 0 registry statements." reads identically whether the project
      // is empty or every statement was deliberately passed over.
      const parts = [
        `Synced ${result.reconciledCount} registry statement${result.reconciledCount === 1 ? "" : "s"}`,
      ];
      if (result.skippedCount > 0) {
        parts.push(`${result.skippedCount} skipped`);
      }
      if (result.warningCount > 0) {
        parts.push(
          `${result.warningCount} warning${result.warningCount === 1 ? "" : "s"}`,
        );
      }
      const message = `${parts.join(" · ")}.`;
      if (parts.length > 1) toast.warning(message);
      else toast.success(message);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "GHG Statements were not synced. Try again.",
      );
    }
  };

  if (query.error) {
    return (
      <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <p className="body-medium text-[var(--clr-red)]" role="alert">
          GHG Statements could not be loaded. Refresh the page and try again.
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
          <div className="flex flex-wrap items-center justify-end gap-12">
            <Button
              variant="default"
              onClick={syncFromRegistry}
              busy={syncMutation.isPending}
              disabled={!gate.canSync}
            >
              <ArrowsClockwiseIcon size={20} weight="bold" />
              Sync from registry
            </Button>
            <Button
              variant="primary"
              onClick={() => setCreateOpen(true)}
              disabled={!gate.canCreate}
            >
              <PlusIcon size={20} weight="bold" />
              New GHG Statement
            </Button>
          </div>
        </div>

        <CreateGateNotice
          notice={gate.notice}
          facilityId={facilityId}
          linkedFacilityCount={summaryQuery.data?.linkedFacilityCount}
        />

        <DataTable
          columns={columns}
          data={statements}
          enableFiltering
          enablePagination
          globalFilter={searchQuery}
          onGlobalFilterChange={setSearchQuery}
          isLoading={query.isLoading}
          hoverable
          onRowClick={(row) => setStatementId(row.statement.id)}
          aria-label="GHG Statements"
          emptyMessage={
            <EmptyState
              icon={<ClipboardTextIcon size={40} />}
              title={
                searchQuery
                  ? "No matching GHG Statements"
                  : "No GHG Statements yet"
              }
              description={
                searchQuery
                  ? "Try clearing your search."
                  : "Sync existing registry statements, or create one for submitted Removals in a reporting period."
              }
              action={
                searchQuery ? undefined : (
                  <Button
                    variant="default"
                    onClick={syncFromRegistry}
                    busy={syncMutation.isPending}
                    disabled={!gate.canSync}
                  >
                    <ArrowsClockwiseIcon size={20} weight="bold" />
                    Sync from registry
                  </Button>
                )
              }
              padding="md"
            />
          }
        >
          <DataTable.Toolbar>
            <DataTable.Search
              placeholder="Search GHG Statements..."
              aria-label="Search GHG Statements"
            />
            <DataTable.Controls>
              <DataTable.ColumnVisibility />
            </DataTable.Controls>
          </DataTable.Toolbar>
          <DataTable.Pagination />
        </DataTable>
      </section>

      {selected && (
        <GhgStatementDetailSheet
          item={selected}
          isProduction={isProduction}
          canManageReports={summaryQuery.data?.viewerCanManage ?? false}
          open
          onClose={() => setStatementId(null)}
        />
      )}

      {/* Keep the dialog mounted once open even if the gate flips (e.g. the
          post-create invalidation refetch errors): unmounting mid-wizard loses
          the operator's step state and the post-create result panel. New opens
          still require the gate via the disabled Create button, and the server
          backstop rejects shared-project creation regardless. */}
      {(gate.canCreate || createOpen) && (
        <GhgStatementCreateDialog
          facilityId={facilityId}
          isProduction={isProduction}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </>
  );
}
