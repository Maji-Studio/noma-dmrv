/**
 * ProductionRunReadingTable component
 * Read-only table of imported production run readings. Telemetry is sourced
 * from readings CSV imports — there is no manual add/edit. The only
 * mutation is "Delete All", which clears the run so a corrected CSV can be
 * re-uploaded and imported.
 */
"use client";

import { useState } from "react";
import { TrashIcon } from "@phosphor-icons/react";
import {
  useProductionRunReadings,
  useDeleteAllProductionRunReadings,
} from "@/hooks/use-production-run-readings";
import { Button } from "@/components/ui";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format-utils";

// ============================================
// Helpers
// ============================================

function formatNum(v: number | null, decimals = 1): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

// ============================================
// Component
// ============================================

interface ProductionRunReadingTableProps {
  productionRunId: string;
  readOnly?: boolean;
}

export function ProductionRunReadingTable({
  productionRunId,
  readOnly = false,
}: ProductionRunReadingTableProps) {
  const {
    data: readings,
    isLoading,
    error,
  } = useProductionRunReadings(productionRunId);
  const deleteAll = useDeleteAllProductionRunReadings();
  const toast = useToast();

  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);

  const readingCount = readings?.length ?? 0;

  const handleDeleteAllConfirm = async () => {
    try {
      const deletedCount = await deleteAll.mutateAsync(productionRunId);
      setConfirmingDeleteAll(false);
      toast.success(
        deletedCount === 0
          ? "No readings to delete"
          : `Deleted ${deletedCount} reading${deletedCount === 1 ? "" : "s"}`
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete readings"
      );
      setConfirmingDeleteAll(false);
    }
  };

  return (
    <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-12">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Production Reading Records
        </h3>
        {!readOnly && readingCount > 0 && (
          <Button
            variant="destructive"
            size="small"
            onClick={() => setConfirmingDeleteAll(true)}
          >
            <TrashIcon size={16} />
            Delete All
          </Button>
        )}
      </div>

      {/* Error */}
      {error && <ServerError message={error.message} />}

      {/* Table */}
      {isLoading ? (
        <TableSkeleton columns={5} rows={3} />
      ) : !readings?.length ? (
        <p className="body-small text-[var(--color-text-tertiary)] py-16">
          {readOnly
            ? "No readings recorded yet."
            : "No readings recorded yet. Upload a readings CSV to import monitoring data."}
        </p>
      ) : (
        <div className="overflow-auto max-h-[420px]">
          <table className="w-full body-small">
            {/* Sticky header so the column labels stay visible once the body
                scrolls past the capped height. bg matches the side-sheet paper
                so rows don't bleed through behind it. */}
            <thead className="sticky top-0 z-10 bg-[var(--color-background-white)]">
              <tr className="border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-tertiary)]">
                <th className="py-8 pr-12 font-medium">Time</th>
                <th className="py-8 pr-12 font-medium">Temp (&deg;C)</th>
                <th className="py-8 pr-12 font-medium">Pressure (bar)</th>
                <th className="py-8 pr-12 font-medium">Dryer (Hz)</th>
                <th className="py-8 font-medium">Reactor (Hz)</th>
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-background-medium)]"
                >
                  <td className="py-8 pr-12 font-medium">
                    {formatDateTime(r.timestamp)}
                  </td>
                  <td className="py-8 pr-12">{formatNum(r.temperatureC, 1)}</td>
                  <td className="py-8 pr-12">{formatNum(r.pressureBar, 2)}</td>
                  <td className="py-8 pr-12">{formatNum(r.dryerFrequencyHz, 1)}</td>
                  <td className="py-8">{formatNum(r.reactorFrequencyHz, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete-all confirmation */}
      {!readOnly && (
        <DeleteConfirmDialog
          isOpen={confirmingDeleteAll}
          title="Delete All Readings"
          message={`This permanently deletes all ${readingCount} reading${readingCount === 1 ? "" : "s"} for this production run. To restore them, re-upload a readings CSV and import it. This cannot be undone.`}
          onConfirm={handleDeleteAllConfirm}
          onCancel={() => setConfirmingDeleteAll(false)}
          isPending={deleteAll.isPending}
        />
      )}
    </div>
  );
}
