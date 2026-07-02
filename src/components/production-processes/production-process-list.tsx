/**
 * ProductionProcessList — operator surface for a facility's production processes
 * (ADR 0017).
 *
 * A production process is the (facility, feedstock) sampling-regime campaign that
 * scopes Method A/B. Each row shows the current sampling method, Method-B
 * baseline progress, and cadence; eligible Method-A rows get a one-click unlock,
 * and any row opens a detail panel hosting the protocol-cited explainer, the
 * non-authoritative unsampled-carbon preview, compliance-drift warnings, and the
 * two human actions (unlock Method B / start a new process). Track 2.
 */
"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { FlowArrowIcon, CheckCircleIcon, LockOpenIcon } from "@phosphor-icons/react";
import { DataTable } from "@/components/ui/data-table";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { InfoHint } from "@/components/ui/tooltip";
import { ServerError } from "@/components/forms";
import {
  METHOD_B_MINIMUM_METHOD_A_SAMPLES,
  METHOD_B_SAMPLING_CADENCE_BATCHES,
} from "@/config/certification";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useProductionProcessesByFacility } from "@/hooks/use-production-processes";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import type { ProductionProcessSummary } from "@/data-access/production-processes";
import { MethodPill } from "./method-pill";
import { ProcessDetailPanel } from "./process-detail-panel";
import { UnlockMethodBDialog } from "./unlock-method-b-dialog";
import { StartNewProcessDialog } from "./start-new-process-dialog";

function createColumns(
  onUnlock: (process: ProductionProcessSummary) => void,
): ColumnDef<ProductionProcessSummary>[] {
  return [
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
      cell: ({ row }) => <MethodPill method={row.original.samplingMethod} />,
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
              <CheckCircleIcon size={14} weight="fill" /> Baseline cleared
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
      // The status badge carries the at-a-glance state; the batch-fraction
      // detail moves to an ⓘ hover to keep the row to a single line.
      cell: ({ row }) => {
        const p = row.original;
        const detail =
          p.samplingMethod === "method_b"
            ? `${p.sampledBatches}/${p.requiredSampledBatches} batches sampled (≥1 per ${METHOD_B_SAMPLING_CADENCE_BATCHES})`
            : `${p.sampledBatches}/${p.totalBatches} batches sampled`;
        return (
          <span className="inline-flex items-center gap-4">
            <StatusBadge
              status={p.cadenceMet ? "complete" : "pending"}
              label={p.cadenceMet ? "On cadence" : `Sample ${p.cadenceShortfall} more`}
              size="small"
            />
            <InfoHint label="Sampling cadence detail">{detail}</InfoHint>
          </span>
        );
      },
      enableSorting: false,
    },
    {
      id: "actions",
      header: "",
      // Only Method-A rows get a row-level unlock CTA; eligible enables it,
      // otherwise it's disabled with the shortfall as its title. Method-B rows
      // are managed from the detail panel (row click). Stop propagation so the
      // button doesn't also open the panel.
      cell: ({ row }) => {
        const p = row.original;
        if (p.samplingMethod === "method_b") return null;
        const shortfall = p.baselineTarget - p.eligibleSampleCount;
        return (
          <div
            className="flex justify-end"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="primary"
              size="small"
              disabled={!p.meetsBaseline}
              title={
                p.meetsBaseline
                  ? undefined
                  : `${shortfall} more eligible sample${shortfall === 1 ? "" : "s"} to qualify`
              }
              onClick={() => onUnlock(p)}
            >
              <LockOpenIcon size={14} weight="bold" />
              Unlock
            </Button>
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}

export function ProductionProcessList() {
  const { facilityId } = useFacilityContext();
  const {
    data: processes,
    isLoading,
    error,
  } = useProductionProcessesByFacility(facilityId, !!facilityId);

  // The protocol-cited explainer (D5) shows only on Isometric facilities — a
  // registry link (`certifier_projects`) is the resolved "is this Isometric"
  // signal (registry-gating), the same one the certification routes gate on.
  const { data: certifierSummary } = useFacilityCertifierSummary(
    facilityId ?? "",
    !!facilityId,
  );
  const isIsometric = !!certifierSummary?.mapping;

  // The three surfaces are keyed by id and re-derive their process from the live
  // query, so they stay correct across the invalidations a mutation triggers
  // (e.g. the row flips to Method B behind an open panel).
  const [detailId, setDetailId] = useState<string | null>(null);
  const [unlockId, setUnlockId] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);

  const rows = processes ?? [];
  const byId = (id: string | null) => rows.find((p) => p.id === id) ?? null;

  const columns = createColumns((process) => setUnlockId(process.id));

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
        area="certification"
        title="Production Processes"
        subtitle="Per-feedstock sampling campaigns — Method A/B regime, baseline progress, and cadence"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-24">
        <StatCard
          title="Production Processes"
          value={totalProcesses}
          icon={<FlowArrowIcon size={24} weight="bold" />}
          description="Active (facility, feedstock) campaigns"
          isLoading={isLoading}
        />
        <StatCard
          title="Method-B Eligible"
          value={eligibleToUnlock}
          icon={<LockOpenIcon size={24} weight="bold" />}
          description={`Cleared the ≥${METHOD_B_MINIMUM_METHOD_A_SAMPLES}-sample baseline; can unlock Method B`}
          isLoading={isLoading}
        />
        <StatCard
          title="Method B Active"
          value={methodBActive}
          icon={<CheckCircleIcon size={24} weight="bold" />}
          description={`Processes sampling ≥1 per ${METHOD_B_SAMPLING_CADENCE_BATCHES} batches`}
          isLoading={isLoading}
        />
      </div>

      <DataTable
        columns={columns}
        data={rows}
        onRowClick={(process) => setDetailId(process.id)}
        isLoading={isLoading}
        enableSorting
        enablePagination
        hoverable
        emptyMessage={
          <EmptyState
            padding="md"
            icon={<FlowArrowIcon size={48} />}
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

      <ProcessDetailPanel
        process={byId(detailId)}
        open={!!detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        isIsometric={isIsometric}
        onUnlock={(process) => setUnlockId(process.id)}
        onStartNewProcess={(process) => setResetId(process.id)}
      />

      <UnlockMethodBDialog
        isOpen={!!unlockId}
        onClose={() => setUnlockId(null)}
        process={byId(unlockId)}
        isIsometric={isIsometric}
      />

      <StartNewProcessDialog
        isOpen={!!resetId}
        onClose={() => setResetId(null)}
        process={byId(resetId)}
      />
    </div>
  );
}
