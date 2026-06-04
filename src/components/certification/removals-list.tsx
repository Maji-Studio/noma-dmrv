/**
 * RemovalsList — the Certification → Removals workspace tab (route:
 * /certification/removals). Replaces the card-grid RemovalsHub with the
 * app-native DataTable idiom (cf. production-runs): one dense, scannable list
 * of every Removal for the selected facility. A row opens a read-only quick
 * view in a side-sheet (`?removal=<id>`, nuqs); the sheet one-click-submits a
 * ready 1:1 removal or routes complex ones to the guided Review flow.
 *
 * Readiness is server-owned: rows come from `useCertificationOverview` (the
 * shared `deriveRemovalReadiness` classifier), so the table hint, the Overview
 * queue, and the Review pre-flight can never disagree. Grouping ungrouped
 * credit batches into removals stays here (the Overview's "needs grouping"
 * nudge links to it) via the lighter `useRemovalsForFacility` read.
 */
"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  ClockCountdown,
  SealCheck,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  useAssignCreditBatchToRemoval,
  useCertificationOverview,
  useEnsureRemovalForCreditBatch,
  useRemovalsForFacility,
} from "@/hooks/use-certification";
import type { RemovalPreflightSummary } from "@/fn/certification";
import type {
  MemberCreditBatch,
  RemovalHubEntry,
} from "@/fn/certification/certify-context";
import { deriveRemovalStatus } from "@/lib/certification/status";
import { RemovalDetailSheet } from "./removal-detail-sheet";

const ICON_SIZE = 14;
const SHORT_ID = 8;
const NEW_REMOVAL = "__new__";

export function RemovalsList() {
  const { facilityId } = useFacilityContext();

  return (
    <div className="container-max flex flex-col gap-32 py-32">
      <header className="flex flex-col gap-8">
        <span className="title-chapter-title text-[var(--color-text-tertiary)]">
          Certification
        </span>
        <h1 className="title-heading-2">Removals</h1>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          A Removal is the registry submission unit. One credit batch maps to
          one Removal by default; group several into one when they share a
          reporting period.
        </p>
      </header>

      {!facilityId ? (
        <EmptyState
          icon={<SealCheck size={48} />}
          title="Select a facility"
          description="Choose a facility from the sidebar to view its removals."
        />
      ) : (
        <ListBody facilityId={facilityId} />
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

function ListBody({ facilityId }: { facilityId: string }) {
  const overview = useCertificationOverview(facilityId);
  // Lighter read for the ungrouped pool + group-into targets (the overview
  // payload carries readiness, not the ungrouped batch list itself).
  const removals = useRemovalsForFacility(facilityId);
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
                  Group a credit batch below to create the first Removal.
                </p>
              </div>
            </div>
          }
        />
      </section>

      <UngroupedSection
        batches={removals.data?.ungroupedBatches ?? []}
        removals={removals.data?.removals ?? []}
        isLoading={removals.isLoading}
        isError={removals.isError}
      />

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

function UngroupedSection({
  batches,
  removals,
  isLoading,
  isError,
}: {
  batches: MemberCreditBatch[];
  removals: RemovalHubEntry[];
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return null;
  // A failed fetch must not masquerade as "every credit batch is assigned" —
  // the empty state below is only correct on a successful, empty response.
  if (isError) {
    return (
      <section className="flex flex-col gap-16">
        <h2 className="title-heading-3">Ungrouped credit batches</h2>
        <p className="body-small text-[var(--clr-red)]" role="alert">
          Couldn&apos;t load ungrouped credit batches. Try refreshing the page.
        </p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-16">
      <h2 className="title-heading-3">
        Ungrouped credit batches{" "}
        <span className="body-small text-[var(--color-text-tertiary)]">
          ({batches.length})
        </span>
      </h2>
      {batches.length === 0 ? (
        <EmptyState
          icon={<ClockCountdown size={32} />}
          title="Every credit batch is assigned"
          description="No ungrouped batches in this facility right now."
          padding="sm"
        />
      ) : (
        <div className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
          {batches.map((batch, index) => (
            <div
              key={batch.id}
              className={
                index > 0 ? "border-t border-[var(--color-border-tertiary)]" : ""
              }
            >
              <UngroupedBatchRow batch={batch} removals={removals} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function UngroupedBatchRow({
  batch,
  removals,
}: {
  batch: MemberCreditBatch;
  removals: RemovalHubEntry[];
}) {
  const ensureMutation = useEnsureRemovalForCreditBatch();
  const assignMutation = useAssignCreditBatchToRemoval();
  const toast = useToast();
  const [choice, setChoice] = useState("");

  const isPending = ensureMutation.isPending || assignMutation.isPending;

  const apply = (value: string) => {
    if (!value) return;
    if (value === NEW_REMOVAL) {
      ensureMutation.mutate(batch.id, {
        onSuccess: () => toast.success(`Started a removal for ${batch.code}.`),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not start removal.",
          ),
      });
      return;
    }
    assignMutation.mutate(
      { creditBatchId: batch.id, removalId: value },
      {
        onSuccess: () => toast.success(`Added ${batch.code} to the removal.`),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not group batch.",
          ),
      },
    );
  };

  return (
    <div className="flex items-center justify-between gap-12 px-20 py-12">
      <div className="flex flex-col gap-2 min-w-0">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Credit batch
        </span>
        <span className="body-small font-mono text-[var(--color-text-primary)]">
          {batch.code}
        </span>
      </div>
      <div className="flex items-center gap-8">
        {isPending && (
          <ArrowsClockwise
            size={ICON_SIZE}
            className="animate-spin text-[var(--color-text-tertiary)]"
          />
        )}
        <select
          aria-label={`Group credit batch ${batch.code} into a removal`}
          className="h-32 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small"
          value={choice}
          disabled={isPending}
          onChange={(e) => {
            const value = e.target.value;
            setChoice("");
            apply(value);
          }}
        >
          <option value="">Group into…</option>
          <option value={NEW_REMOVAL}>＋ New removal</option>
          {removals.map((entry) => (
            <option key={entry.removal.id} value={entry.removal.id}>
              Removal {entry.removal.id.slice(0, SHORT_ID)}… (
              {entry.memberBatches.length})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
