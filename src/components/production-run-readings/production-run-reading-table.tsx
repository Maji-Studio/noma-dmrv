/**
 * ProductionRunReadingTable component
 * Inline table of production run readings with inline add/edit form,
 * rendered within production run detail (like ProductionSampleTable)
 */
"use client";

import { useState } from "react";
import { Plus, Pencil, Trash } from "@phosphor-icons/react";
import {
  useProductionRunReadings,
  useCreateProductionRunReading,
  useUpdateProductionRunReading,
  useDeleteProductionRunReading,
} from "@/hooks/use-production-run-readings";
import { Button } from "@/components/ui";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { ProductionRunReadingForm } from "./production-run-reading-form";
import type { ProductionRunReadingWithRelations } from "@/data-access/production-run-readings";
import type { ProductionRunReadingFormData } from "@/schemas/production-run-readings";

// ============================================
// Helpers
// ============================================

function formatTimestamp(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNum(v: number | null, decimals = 1): string {
  if (v == null) return "\u2014";
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
  const createReading = useCreateProductionRunReading();
  const updateReading = useUpdateProductionRunReading();
  const deleteReading = useDeleteProductionRunReading();
  const toast = useToast();

  const [inlineForm, setInlineForm] = useState<
    | { open: false }
    | { open: true; reading?: ProductionRunReadingWithRelations }
  >({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const openCreate = () => {
    setFormError(null);
    setInlineForm({ open: true });
  };
  const openEdit = (reading: ProductionRunReadingWithRelations) => {
    setFormError(null);
    setInlineForm({ open: true, reading });
  };
  const closeForm = () => setInlineForm({ open: false });

  const handleSubmit = async (data: ProductionRunReadingFormData) => {
    setFormError(null);
    try {
      if (inlineForm.open && inlineForm.reading) {
        await updateReading.mutateAsync({
          readingId: inlineForm.reading.id,
          timestamp:
            typeof data.timestamp === "string"
              ? new Date(data.timestamp)
              : data.timestamp,
          temperatureC: data.temperatureC ?? null,
          pressureBar: data.pressureBar ?? null,
          gasFlowRate: data.gasFlowRate ?? null,
        });
        toast.success("Reading updated");
      } else {
        await createReading.mutateAsync(data);
        toast.success("Reading added");
      }
      closeForm();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to save reading"
      );
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    try {
      await deleteReading.mutateAsync(deletingId);
      setDeletingId(null);
      toast.success("Reading deleted");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete reading"
      );
      setDeletingId(null);
    }
  };

  const isSubmitting = createReading.isPending || updateReading.isPending;

  return (
    <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Production Readings
        </h3>
        {!readOnly && !inlineForm.open && (
          <Button variant="default" size="small" onClick={openCreate}>
            <Plus size={16} weight="bold" />
            Add Reading
          </Button>
        )}
      </div>

      {/* Error */}
      {error && <ServerError message={error.message} />}

      {/* Table */}
      {isLoading ? (
        <TableSkeleton columns={readOnly ? 4 : 5} rows={3} />
      ) : !readings?.length && !inlineForm.open ? (
        <p className="body-small text-[var(--color-text-tertiary)] py-16">
          {readOnly
            ? "No readings recorded yet."
            : "No readings recorded yet. Click \"Add Reading\" to record monitoring data."}
        </p>
      ) : readings?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full body-small">
            <thead>
              <tr className="border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-tertiary)]">
                <th className="py-8 pr-12 font-medium">Time</th>
                <th className="py-8 pr-12 font-medium">Temp (&deg;C)</th>
                <th className="py-8 pr-12 font-medium">Pressure (bar)</th>
                <th className="py-8 pr-12 font-medium">Gas Flow</th>
                {!readOnly && (
                  <th className="py-8 font-medium text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {readings.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-background-medium)]"
                >
                  <td className="py-8 pr-12 font-medium">
                    {formatTimestamp(r.timestamp)}
                  </td>
                  <td className="py-8 pr-12">{formatNum(r.temperatureC, 1)}</td>
                  <td className="py-8 pr-12">{formatNum(r.pressureBar, 2)}</td>
                  <td className="py-8 pr-12">{formatNum(r.gasFlowRate, 3)}</td>
                  {!readOnly && (
                    <td className="py-8 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <Button
                          variant="noOutline"
                          size="icon"
                          onClick={() => openEdit(r)}
                          aria-label="Edit reading"
                          disabled={inlineForm.open}
                        >
                          <Pencil size={16} />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => setDeletingId(r.id)}
                          aria-label="Delete reading"
                          disabled={inlineForm.open}
                        >
                          <Trash size={16} />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Inline Add/Edit Form */}
      {!readOnly && inlineForm.open && (
        <div className="border border-[var(--color-border-primary)] bg-[var(--color-background-white)] p-24">
          <h4 className="title-heading-4 mb-16">
            {inlineForm.reading ? "Edit Reading" : "Add Reading"}
          </h4>
          {formError && (
            <div className="mb-16">
              <ServerError message={formError} />
            </div>
          )}
          <ProductionRunReadingForm
            key={inlineForm.reading?.id ?? "create"}
            productionRunId={productionRunId}
            reading={inlineForm.reading}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            isSubmitting={isSubmitting}
          />
        </div>
      )}

      {/* Delete Confirmation */}
      {!readOnly && (
        <DeleteConfirmDialog
          isOpen={!!deletingId}
          title="Delete Reading"
          message="Are you sure you want to delete this reading? This action cannot be undone."
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingId(null)}
          isPending={deleteReading.isPending}
        />
      )}
    </div>
  );
}
