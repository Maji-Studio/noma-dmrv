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
  CheckCircle,
  Plus,
  SealCheck,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { DataTable } from "@/components/ui/data-table";
import { Button, EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useCertificationOverview } from "@/hooks/use-certification";
import type { RemovalPreflightSummary } from "@/fn/certification";
import { deriveRemovalStatus } from "@/lib/certification/status";
import { NewRemovalDialog } from "./new-removal-dialog";
import { RemovalDetailSheet } from "./removal-detail-sheet";

const SHORT_ID = 8;

export function RemovalsList() {
  const { facilityId } = useFacilityContext();
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
    <div className="container-max flex flex-col gap-32 py-32">
      <header className="flex items-start justify-between gap-16">
        <div className="flex flex-col gap-8">
          <span className="title-chapter-title text-[var(--color-text-tertiary)]">
            Certification
          </span>
          <h1 className="title-heading-2">Removals</h1>
          <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
            A Removal is the registry submission unit. Group one or more complete
            credit batches that share a reporting period into a removal, then
            submit it to the registry.
          </p>
        </div>
        {facilityId && (
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            <Plus size={16} weight="bold" />
            New removal
          </Button>
        )}
      </header>

      {!facilityId ? (
        <EmptyState
          icon={<SealCheck size={48} />}
          title="Select a facility"
          description="Choose a facility from the sidebar to view its removals."
        />
      ) : (
        <ListBody facilityId={facilityId} onNewRemoval={() => setDialogOpen(true)} />
      )}

      {facilityId && (
        <NewRemovalDialog
          facilityId={facilityId}
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

function reportingWindow(summary: RemovalPreflightSummary): string {
  return summary.startedOn && summary.completedOn
    ? `${summary.startedOn} → ${summary.completedOn}`
    : "Set on submit";
}

function RemovalCell({ summary }: { summary: RemovalPreflightSummary }) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <span className="body-small font-mono text-[var(--color-text-primary)] truncate">
        {shortId(summary.removalId)}…
      </span>
      <span className="body-caption text-[var(--color-text-tertiary)]">
        {reportingWindow(summary)}
      </span>
    </div>
  );
}

function MemberBatchesCell({ summary }: { summary: RemovalPreflightSummary }) {
  const { memberBatchCodes } = summary;
  if (memberBatchCodes.length === 0) {
    return <span className="body-small text-[var(--color-text-tertiary)]">—</span>;
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

function StatusCell({ summary }: { summary: RemovalPreflightSummary }) {
  const derived = deriveRemovalStatus({
    local: summary.local,
    lockInFlight: summary.lockInFlight,
  });
  return <StatusBadge status={derived.value} label={derived.label} />;
}

function ReadinessCell({ summary }: { summary: RemovalPreflightSummary }) {
  const { state, reasons } = summary.readiness;
  if (state === "ready") {
    return (
      <span className="inline-flex items-center gap-6 body-caption text-[var(--color-signal-green)]">
        <CheckCircle size={16} weight="fill" aria-hidden />
        Ready to submit
      </span>
    );
  }
  if (state === "blocked") {
    return (
      <span className="inline-flex items-start gap-6 body-caption text-[var(--color-signal-orange)]">
        <Warning size={16} weight="fill" aria-hidden className="mt-px shrink-0" />
        <span className="line-clamp-2">{reasons.join(" · ")}</span>
      </span>
    );
  }
  // submitted / inProgress — the status column already carries the verdict.
  return <span className="body-caption text-[var(--color-text-tertiary)]">—</span>;
}

const columns: ColumnDef<RemovalPreflightSummary>[] = [
  {
    id: "removal",
    header: "Removal",
    cell: ({ row }) => <RemovalCell summary={row.original} />,
  },
  {
    id: "batches",
    header: "Credit batches",
    cell: ({ row }) => <MemberBatchesCell summary={row.original} />,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusCell summary={row.original} />,
  },
  {
    id: "readiness",
    header: "Readiness",
    cell: ({ row }) => <ReadinessCell summary={row.original} />,
  },
];

function ListBody({
  facilityId,
  onNewRemoval,
}: {
  facilityId: string;
  onNewRemoval: () => void;
}) {
  const overview = useCertificationOverview(facilityId);
  const [removalId, setRemovalId] = useQueryState(
    "removal",
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );

  if (overview.error) {
    return (
      <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
        <p className="body-medium text-[var(--clr-red)]" role="alert">
          Unable to load removals. Try refreshing the page.
        </p>
      </div>
    );
  }

  const data = overview.data;
  const rows = data?.removals ?? [];
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
          isLoading={overview.isLoading}
          hoverable
          onRowClick={(row) => setRemovalId(row.removalId)}
          aria-label="Removals"
          emptyMessage={
            <div className="flex flex-col items-center justify-center gap-12 py-48">
              <SealCheck size={40} className="text-[var(--color-text-tertiary)]" />
              <div className="text-center">
                <h3 className="title-heading-3 mb-1">No removals yet</h3>
                <p className="body-small text-[var(--color-text-secondary)]">
                  Start one with “New removal” to group complete credit batches.
                </p>
              </div>
              <Button variant="default" onClick={onNewRemoval}>
                <Plus size={16} weight="bold" />
                New removal
              </Button>
            </div>
          }
        />
      </section>

      {selected && data && (
        <RemovalDetailSheet
          summary={selected}
          isProduction={data.isProduction}
          facilityId={facilityId}
          open
          onClose={() => setRemovalId(null)}
        />
      )}
    </>
  );
}
