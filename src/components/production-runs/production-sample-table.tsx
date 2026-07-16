/**
 * ProductionSampleTable component
 * Inline table of production samples with inline add/edit form, rendered within production run detail
 */
"use client";

import { useState } from "react";
import { PlusIcon, PencilIcon, TrashIcon } from "@phosphor-icons/react";
import {
  useProductionSamples,
  useCreateProductionSample,
  useUpdateProductionSample,
  useDeleteProductionSample,
} from "@/hooks/use-production-samples";
import { Button } from "@/components/ui";
import { ServerError } from "@/components/forms";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { ProductionSampleForm } from "./production-sample-form";
import { useDeferredAttachments } from "@/hooks/use-deferred-attachments";
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
  readOnly?: boolean;
}

export function ProductionSampleTable({
  productionRunId,
  readOnly = false,
}: ProductionSampleTableProps) {
  const { data: samples, isLoading, error } = useProductionSamples(productionRunId);
  const createSample = useCreateProductionSample();
  const updateSample = useUpdateProductionSample();
  const deleteSample = useDeleteProductionSample(productionRunId);
  const toast = useToast();
  const deferredAttachments = useDeferredAttachments();
  const [isFlushing, setIsFlushing] = useState(false);

  // Inline form state: "closed" | { mode: "create" } | { mode: "edit", sample }
  const [inlineForm, setInlineForm] = useState<
    | { open: false }
    | { open: true; sample?: ProductionSampleWithRelations }
  >({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const openCreate = () => {
    setFormError(null);
    deferredAttachments.clear();
    setInlineForm({ open: true });
  };
  const openEdit = (sample: ProductionSampleWithRelations) => {
    setFormError(null);
    deferredAttachments.clear();
    setInlineForm({ open: true, sample });
  };
  const closeForm = () => {
    setInlineForm({ open: false });
    setFormError(null);
    deferredAttachments.clear();
  };

  const handleRetryDeferredAttachments = async (key?: string) => {
    if (!inlineForm.open || !inlineForm.sample) return;
    const failedBefore = deferredAttachments.attachments.filter(
      (attachment) => attachment.status === "failed",
    ).length;
    const result = await deferredAttachments.retry(
      "production_sample",
      inlineForm.sample.id,
      key,
    );
    if (result.ok && (key === undefined || failedBefore === 1)) {
      setFormError(null);
    }
  };

  const handleRemoveDeferredAttachment = (key: string) => {
    const failedBefore = deferredAttachments.attachments.filter(
      (attachment) => attachment.status === "failed",
    ).length;
    deferredAttachments.remove(key);
    if (failedBefore === 1) setFormError(null);
  };

  const handleSubmit = async (data: ProductionSampleFormData) => {
    setFormError(null);
    try {
      if (inlineForm.open && inlineForm.sample) {
        if (
          deferredAttachments.attachments.some(
            (attachment) => attachment.status === "failed",
          )
        ) {
          setFormError(
            "Resolve or remove the failed attachments before saving this sample.",
          );
          return;
        }
        await updateSample.mutateAsync({
          productionSampleId: inlineForm.sample.id,
          ...data,
        });
        toast.success("Sample updated");
      } else {
        const createdSample = await createSample.mutateAsync(data);
        setIsFlushing(true);
        const flushResult = await deferredAttachments.flush(
          "production_sample",
          createdSample.id,
        );
        if (!flushResult.ok) {
          setInlineForm({ open: true, sample: createdSample });
          setFormError(
            `Production sample created, but ${flushResult.failed.length} ${flushResult.failed.length === 1 ? "attachment" : "attachments"} failed to upload.`,
          );
          return;
        }
        deferredAttachments.clear();
        toast.success("Sample added");
      }
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save sample");
    } finally {
      setIsFlushing(false);
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

  const isSubmitting =
    createSample.isPending || updateSample.isPending || isFlushing;

  // NOTE: no certification replicate chip here. These are in-process production
  // samples; the ≥3-replicate / eligibility certification signal is judged on the
  // lab `Sample` records the Certify path actually reads
  // (`getProductionRunsWithSamples`), not this table — surfacing a `CERT n/3`
  // chip off this count would misreport certification coverage.

  return (
    <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Production Samples
        </h3>
        {!readOnly && !inlineForm.open && (
          <Button variant="default" size="small" onClick={openCreate}>
            <PlusIcon size={16} weight="bold" />
            Add Sample
          </Button>
        )}
      </div>

      {/* Error */}
      {error && <ServerError message={error.message} />}

      {/* Table */}
      {isLoading ? (
        <TableSkeleton columns={readOnly ? 7 : 8} rows={3} />
      ) : !samples?.length && !inlineForm.open ? (
        <p className="body-small text-[var(--color-text-tertiary)] py-16">
          {readOnly
            ? "No samples recorded yet."
            : "No samples recorded yet. Click \"Add Sample\" to record an in-process measurement."}
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
                {!readOnly && (
                  <th className="py-8 font-medium text-right">Actions</th>
                )}
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
                  {!readOnly && (
                    <td className="py-8 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <Button
                          variant="noOutline"
                          size="icon"
                          onClick={() => openEdit(s)}
                          aria-label="Edit sample"
                          disabled={inlineForm.open}
                        >
                          <PencilIcon size={16} />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => setDeletingId(s.id)}
                          aria-label="Delete sample"
                          disabled={inlineForm.open}
                        >
                          <TrashIcon size={16} />
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
            deferredAttachments={deferredAttachments}
            onRetryDeferredAttachment={handleRetryDeferredAttachments}
            onRemoveDeferredAttachment={handleRemoveDeferredAttachment}
          />
        </div>
      )}

      {/* Delete Confirmation */}
      {!readOnly && (
        <DeleteConfirmDialog
          isOpen={!!deletingId}
          title="Delete Production Sample"
          message="Are you sure you want to delete this sample? This action cannot be undone."
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingId(null)}
          isPending={deleteSample.isPending}
        />
      )}
    </div>
  );
}
