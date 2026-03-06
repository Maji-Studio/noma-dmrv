/**
 * ProductionSampleTable component
 * Inline table of production samples with inline add/edit form, rendered within production run detail
 */
"use client";

import { useState } from "react";
import { Plus, Pencil, Trash } from "@phosphor-icons/react";
import {
  useProductionSamples,
  useCreateProductionSample,
  useUpdateProductionSample,
  useDeleteProductionSample,
} from "@/hooks/use-production-samples";
import { Button } from "@/components/ui";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ProductionSampleForm } from "./production-sample-form";
import type { ProductionSampleWithRelations } from "@/data-access/production-samples";
import type { ProductionSampleFormData } from "@/schemas/production-samples";

// ============================================
// Helpers
// ============================================

function formatTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNum(v: number | null, unit?: string): string {
  if (v == null) return "\u2014";
  return unit ? `${v}${unit}` : String(v);
}

// ============================================
// Component
// ============================================

interface ProductionSampleTableProps {
  productionRunId: string;
}

export function ProductionSampleTable({
  productionRunId,
}: ProductionSampleTableProps) {
  const { data: samples, isLoading, error } = useProductionSamples(productionRunId);
  const createSample = useCreateProductionSample();
  const updateSample = useUpdateProductionSample();
  const deleteSample = useDeleteProductionSample(productionRunId);
  const toast = useToast();

  // Inline form state: "closed" | { mode: "create" } | { mode: "edit", sample }
  const [inlineForm, setInlineForm] = useState<
    | { open: false }
    | { open: true; sample?: ProductionSampleWithRelations }
  >({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const openCreate = () => {
    setFormError(null);
    setInlineForm({ open: true });
  };
  const openEdit = (sample: ProductionSampleWithRelations) => {
    setFormError(null);
    setInlineForm({ open: true, sample });
  };
  const closeForm = () => setInlineForm({ open: false });

  const handleSubmit = async (data: ProductionSampleFormData) => {
    setFormError(null);
    try {
      if (inlineForm.open && inlineForm.sample) {
        await updateSample.mutateAsync({
          productionSampleId: inlineForm.sample.id,
          ...data,
        });
        toast.success("Sample updated");
      } else {
        await createSample.mutateAsync(data);
        toast.success("Sample added");
      }
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save sample");
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    try {
      await deleteSample.mutateAsync(deletingId);
      setDeletingId(null);
      toast.success("Sample deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete sample");
      setDeletingId(null);
    }
  };

  const isSubmitting = createSample.isPending || updateSample.isPending;

  return (
    <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Production Samples
        </h3>
        {!inlineForm.open && (
          <Button variant="default" size="small" onClick={openCreate}>
            <Plus size={16} weight="bold" />
            Add Sample
          </Button>
        )}
      </div>

      {/* Error */}
      {error && <ServerError message={error.message} />}

      {/* Table */}
      {isLoading ? (
        <p className="body-small text-[var(--color-text-tertiary)] py-16">
          Loading samples...
        </p>
      ) : !samples?.length && !inlineForm.open ? (
        <p className="body-small text-[var(--color-text-tertiary)] py-16">
          No samples recorded yet. Click &ldquo;Add Sample&rdquo; to record an in-process measurement.
        </p>
      ) : samples?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full body-small">
            <thead>
              <tr className="border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-tertiary)]">
                <th className="py-8 pr-12 font-medium">Code</th>
                <th className="py-8 pr-12 font-medium">Time</th>
                <th className="py-8 pr-12 font-medium">Temp</th>
                <th className="py-8 pr-12 font-medium">Weight</th>
                <th className="py-8 pr-12 font-medium">Moisture</th>
                <th className="py-8 pr-12 font-medium">Fixed C</th>
                <th className="py-8 pr-12 font-medium">Operator</th>
                <th className="py-8 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-background-medium)]"
                >
                  <td className="py-8 pr-12 font-medium text-[var(--clr-dark-purple)]">
                    {s.sampleCode ?? "\u2014"}
                  </td>
                  <td className="py-8 pr-12">{formatTimestamp(s.timestamp)}</td>
                  <td className="py-8 pr-12">{formatNum(s.temperatureC, "\u00B0C")}</td>
                  <td className="py-8 pr-12">{formatNum(s.weightGrams, "g")}</td>
                  <td className="py-8 pr-12">{formatNum(s.moistureContentPercent, "%")}</td>
                  <td className="py-8 pr-12">{formatNum(s.fixedCarbonPercent, "%")}</td>
                  <td className="py-8 pr-12">{s.operatorName ?? "\u2014"}</td>
                  <td className="py-8 text-right">
                    <div className="flex items-center justify-end gap-4">
                      <button
                        type="button"
                        onClick={() => openEdit(s)}
                        className="p-6 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
                        aria-label="Edit sample"
                        disabled={inlineForm.open}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingId(s.id)}
                        className="p-6 text-[var(--color-text-tertiary)] hover:text-[var(--color-signal-red)] transition-colors"
                        aria-label="Delete sample"
                        disabled={inlineForm.open}
                      >
                        <Trash size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Inline Add/Edit Form */}
      {inlineForm.open && (
        <div className="border border-[var(--color-border-primary)] bg-[var(--color-background-white)] p-24">
          <h4 className="title-heading-4 mb-16">
            {inlineForm.sample ? "Edit Sample" : "Add Production Sample"}
          </h4>
          {formError && <div className="mb-16"><ServerError message={formError} /></div>}
          <ProductionSampleForm
            key={inlineForm.sample?.id ?? "create"}
            productionRunId={productionRunId}
            sample={inlineForm.sample}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            isSubmitting={isSubmitting}
          />
        </div>
      )}

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        isOpen={!!deletingId}
        title="Delete Production Sample"
        message="Are you sure you want to delete this sample? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingId(null)}
        isPending={deleteSample.isPending}
      />
    </div>
  );
}
