/**
 * ProductionRunReadingTable component
 * Read-only table of imported production run readings. Telemetry is sourced
 * from readings CSV imports — there is no manual add/edit. The only
 * mutation is "Delete all", which clears the run so a corrected CSV can be
 * re-uploaded and imported.
 */
"use client";

// No mounted operator entry point. The retained-file workflow is described in docs/architecture.md.

import { useState } from "react";
import { TrashIcon } from "@phosphor-icons/react/dist/ssr";
import {
  useProductionRunReadings,
  useDeleteAllProductionRunReadings,
} from "@/hooks/use-production-run-readings";
import { Button } from "@/components/ui";
import { ServerError } from "@/components/forms/server-error";
import { Notice } from "@/components/ui/notice";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { formatFacilityDateTimeWithOffset } from "@/lib/format-utils";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { PRODUCTION_RUN_READINGS_LIMIT } from "@/config/production-run-readings";

const TABLE_MAX_HEIGHT_CLASS = "max-h-[420px]";
const COMPACT_TABLE_MAX_HEIGHT_CLASS = "max-h-[240px]";

// ============================================
// Helpers
// ============================================

function formatNum(v: number | null, decimals = 1): string {
  if (v == null) return MISSING_VALUE.notRecorded;
  return v.toFixed(decimals);
}

// ============================================
// Component
// ============================================

interface ProductionRunReadingTableProps {
  productionRunId: string;
  timeZone: string;
  readOnly?: boolean;
  /** Keep the bounded preview in a shorter scroll area. */
  compact?: boolean;
}

export function ProductionRunReadingTable({
  productionRunId,
  timeZone,
  readOnly = false,
  compact = false,
}: ProductionRunReadingTableProps) {
  const {
    data,
    isLoading,
    error,
  } = useProductionRunReadings(productionRunId);
  const deleteAll = useDeleteAllProductionRunReadings();
  const toast = useToast();

  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);

  const readings = data?.readings.slice(0, PRODUCTION_RUN_READINGS_LIMIT) ?? [];
  const truncated = data?.truncated || (data?.readings.length ?? 0) > PRODUCTION_RUN_READINGS_LIMIT;
  const readingCount = readings.length;

  if (!isLoading && !error && readingCount === 0) {
    return null;
  }

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
        err instanceof Error ? err.message : "The readings were not deleted. Try again."
      );
      setConfirmingDeleteAll(false);
    }
  };

  return (
    <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-12">
        <h3 className="body-small font-medium text-[var(--color-text-primary)]">
          Imported readings{readingCount > 0 ? ` (${readingCount})` : ""}
        </h3>
        {!readOnly && readingCount > 0 && (
          <Button
            variant="destructive"
            size="small"
            onClick={() => setConfirmingDeleteAll(true)}
          >
            <TrashIcon size={16} />
            Delete all
          </Button>
        )}
      </div>

      {/* Error */}
      {error && <ServerError message={error.message} />}

      {truncated && (
        <Notice tone="info">
          {`Showing the latest ${readingCount} readings. Older readings are not shown.`}
        </Notice>
      )}

      {/* Table */}
      {isLoading ? (
        <TableSkeleton columns={5} rows={3} />
      ) : readings?.length ? (
        <div
          className={`overflow-auto ${
            compact
              ? COMPACT_TABLE_MAX_HEIGHT_CLASS
              : TABLE_MAX_HEIGHT_CLASS
          }`}
        >
          <table className="w-full body-small">
            {/* Sticky header so the column labels stay visible once the body
                scrolls past the capped height. bg matches the side-sheet paper
                so rows don't bleed through behind it. */}
            <thead className="sticky top-0 z-10 bg-[var(--color-background-white)]">
              <tr className="border-b border-[var(--color-border-primary)] text-left body-small text-[var(--color-text-secondary)]">
                <th className="py-8 pr-12 font-medium">
                  Time ({timeZone.replace(/_/g, " ")})
                </th>
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
                    {formatFacilityDateTimeWithOffset(r.timestamp, timeZone)}
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
      ) : null}

      {/* Delete-all confirmation */}
      {!readOnly && (
        <DeleteConfirmDialog
          isOpen={confirmingDeleteAll}
          title="Delete all readings"
          message="This permanently deletes all readings for this production run, including readings not shown here. To restore them, re-upload a readings CSV and import it. This cannot be undone."
          onConfirm={handleDeleteAllConfirm}
          onCancel={() => setConfirmingDeleteAll(false)}
          isPending={deleteAll.isPending}
        />
      )}
    </div>
  );
}
