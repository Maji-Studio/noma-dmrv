/**
 * ProductionProcessList — read-only operator surface for a facility's
 * production processes (ADR 0017 Track 1.5).
 *
 * A production process is the (facility, feedstock) sampling-regime campaign
 * that scopes Method A/B. This view shows each process's current sampling
 * method, its Method-B baseline progress, and its cadence status. It is
 * read-only today; the Method-B unlock action and the protocol-cited explanation
 * surface ship with Track 2.
 */
"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { FlowArrow, CheckCircle, Lock, LockOpen } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState, PageHeader } from "@/components/ui";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ServerError } from "@/components/forms";
import {
  METHOD_B_MINIMUM_METHOD_A_SAMPLES,
  METHOD_B_SAMPLING_CADENCE_BATCHES,
} from "@/config/certification";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useProductionProcessesByFacility } from "@/hooks/use-production-processes";
import { formatLocalDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { ProductionProcessSummary } from "@/data-access/production-processes";

function MethodPill({ process }: { process: ProductionProcessSummary }) {
  const isMethodB = process.samplingMethod === "method_b";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-4 border px-8 py-2 body-caption font-medium",
        isMethodB
          ? "bg-[var(--st-run-bg)] text-[var(--st-run)] border-[var(--st-run-border)]"
          : "bg-[var(--st-off-bg)] text-[var(--color-text-secondary)] border-[var(--st-off-border)]",
      )}
    >
      {isMethodB ? <LockOpen size={12} weight="bold" /> : <Lock size={12} weight="bold" />}
      {isMethodB ? "Method B" : "Method A"}
    </span>
  );
}

const COLUMNS: ColumnDef<ProductionProcessSummary>[] = [
  {
    accessorKey: "feedstockName",
    header: "Feedstock",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium text-[var(--clr-dark-purple)]">
          {row.original.feedstockName}
        </span>
        <span className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">
          {row.original.feedstockCode}
        </span>
      </div>
    ),
  },
  {
    id: "samplingMethod",
    header: "Sampling method",
    cell: ({ row }) => <MethodPill process={row.original} />,
    enableSorting: false,
  },
  {
    id: "baseline",
    header: "Method-B baseline",
    cell: ({ row }) => {
      const p = row.original;
      // Method B is already past the baseline (it was unlocked); Method A
      // processes show their progress toward the configured sample bar.
      if (p.samplingMethod === "method_b") {
        return (
          <span className="inline-flex items-center gap-4 body-small text-[var(--st-ok)]">
            <CheckCircle size={14} weight="fill" /> Baseline cleared
          </span>
        );
      }
      return (
        <div className="flex flex-col gap-2">
          <span className="body-small tabular-nums">
            {p.eligibleSampleCount} / {p.baselineTarget} eligible samples
          </span>
          {p.meetsBaseline ? (
            <span className="body-caption text-[var(--st-ok)]">
              Eligible to unlock Method B
            </span>
          ) : (
            <span className="body-caption text-[var(--color-text-tertiary)]">
              {p.baselineTarget - p.eligibleSampleCount} more to qualify
            </span>
          )}
        </div>
      );
    },
  },
  {
    id: "cadence",
    header: "Cadence",
    cell: ({ row }) => {
      const p = row.original;
      const detail =
        p.samplingMethod === "method_b"
          ? `${p.sampledBatches}/${p.requiredSampledBatches} batches (≥1 per ${METHOD_B_SAMPLING_CADENCE_BATCHES})`
          : `${p.sampledBatches}/${p.totalBatches} batches sampled`;
      return (
        <div className="flex flex-col gap-2">
          <StatusBadge
            status={p.cadenceMet ? "complete" : "pending"}
            label={p.cadenceMet ? "On cadence" : `Sample ${p.cadenceShortfall} more`}
            size="small"
          />
          <span className="body-caption text-[var(--color-text-tertiary)] tabular-nums">
            {detail}
          </span>
        </div>
      );
    },
    enableSorting: false,
  },
  {
    accessorKey: "establishedAt",
    header: "Established",
    cell: ({ row }) => (
      <span className="body-small text-[var(--color-text-secondary)]">
        {formatLocalDate(row.original.establishedAt)}
      </span>
    ),
  },
];

export function ProductionProcessList() {
  const { facilityId } = useFacilityContext();
  const {
    data: processes,
    isLoading,
    error,
  } = useProductionProcessesByFacility(facilityId, !!facilityId);

  const rows = processes ?? [];

  const totalProcesses = rows.length;
  const methodBActive = rows.filter(
    (p) => p.samplingMethod === "method_b",
  ).length;
  const eligibleToUnlock = rows.filter(
    (p) => p.samplingMethod === "method_a" && p.meetsBaseline,
  ).length;

  if (error) {
    return (
      <div className="container-max py-32">
        <ServerError message={error.message || "Failed to load production processes"} />
      </div>
    );
  }

  return (
    <div className="container-max page-shell">
      <PageHeader
        area="verification"
        title="Production Processes"
        subtitle="Per-feedstock sampling campaigns — Method A/B regime, baseline progress, and cadence"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-24">
        <StatCard
          title="Production Processes"
          value={totalProcesses}
          icon={<FlowArrow size={24} weight="bold" />}
          description="Active (facility, feedstock) campaigns"
          isLoading={isLoading}
        />
        <StatCard
          title="Method-B Eligible"
          value={eligibleToUnlock}
          icon={<LockOpen size={24} weight="bold" />}
          description={`Cleared the ≥${METHOD_B_MINIMUM_METHOD_A_SAMPLES}-sample baseline; can unlock Method B`}
          isLoading={isLoading}
        />
        <StatCard
          title="Method B Active"
          value={methodBActive}
          icon={<CheckCircle size={24} weight="bold" />}
          description={`Processes sampling ≥1 per ${METHOD_B_SAMPLING_CADENCE_BATCHES} batches`}
          isLoading={isLoading}
        />
      </div>

      <DataTable
        columns={COLUMNS}
        data={rows}
        isLoading={isLoading}
        enableSorting
        enablePagination
        hoverable
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<FlowArrow size={48} />}
            title={facilityId ? "No production processes yet" : "Select a facility"}
            description={
              facilityId
                ? "A production process is created automatically when you build a credit batch for a feedstock."
                : "Choose a facility from the sidebar to view its production processes."
            }
          />
        }
      >
        <DataTable.Pagination />
      </DataTable>
    </div>
  );
}
