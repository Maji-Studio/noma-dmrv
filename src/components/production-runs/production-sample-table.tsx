/**
 * ProductionSampleTable component
 * Production sample table with dialog-based add/edit forms, rendered within
 * production run detail.
 */
"use client";

import { useState } from "react";
import { PlusIcon, PencilIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import {
  useProductionSamples,
  useCreateProductionSample,
  useUpdateProductionSample,
  useDeleteProductionSample,
} from "@/hooks/use-production-samples";
import { Button } from "@/components/ui";
import { ServerError } from "@/components/forms";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { ProductionSampleForm } from "./production-sample-form";
import { useCreateWithEvidence } from "@/hooks/use-create-with-evidence";
import type { ProductionSampleWithRelations } from "@/data-access/production-samples";
import type { ProductionSampleFormData } from "@/schemas/production-samples";
import { formatDateTime } from "@/lib/format-utils";

// ============================================
// Helpers
// ============================================

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

  const [formDialog, setFormDialog] = useState<
    | { open: false }
    | { open: true; sample?: ProductionSampleWithRelations }
  >({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const createWithEvidence = useCreateWithEvidence({
    entityType: "production_sample",
    entityNoun: "Production sample",
    executeCreate: async (data: ProductionSampleFormData) => {
      const sample = await createSample.mutateAsync(data);
      return { entities: [sample], result: sample };
    },
    setError: setFormError,
    setUpdateError: setFormError,
    getCreateErrorMessage: (error) =>
      error instanceof Error ? error.message : "Failed to save sample",
    unresolvedUpdateMessage:
      "Resolve or remove the failed attachments before saving this sample.",
    openEditOnFailure: (sample) =>
      setFormDialog({ open: true, sample }),
    closeOnSuccess: () => closeForm(),
    onSuccess: () => toast.success("Sample added"),
  });
  const { deferredAttachments, isFlushing } = createWithEvidence;

  const openCreate = () => {
    setFormError(null);
    createWithEvidence.reset();
    setFormDialog({ open: true });
  };
  const openEdit = (sample: ProductionSampleWithRelations) => {
    setFormError(null);
    createWithEvidence.reset();
    setFormDialog({ open: true, sample });
  };
  const closeForm = () => {
    setFormDialog({ open: false });
    setFormError(null);
    createWithEvidence.reset();
  };

  const handleRetryDeferredAttachments = async (key?: string) => {
    if (!formDialog.open || !formDialog.sample) return;
    const sampleId = formDialog.sample.id;
    const failedBefore = deferredAttachments.attachments.filter(
      (attachment) => attachment.status === "failed",
    ).length;
    // Bracket the retry with isFlushing (which feeds isSubmitting) so a save or
    // close cannot fire while attachments are mid-`uploading` and clear the
    // retry state out from under this handler.
    await createWithEvidence.runWhileFlushing(async () => {
      const result = await deferredAttachments.retry(
        "production_sample",
        [sampleId],
        key,
      );
      if (result.ok && (key === undefined || failedBefore === 1)) {
        setFormError(null);
      }
    });
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
    if (!formDialog.open || !formDialog.sample) {
      await createWithEvidence.handleCreate(data);
      return;
    }
    try {
      if (createWithEvidence.guardUpdate()) return;
      await updateSample.mutateAsync({
        productionSampleId: formDialog.sample.id,
        ...data,
      });
      toast.success("Sample updated");
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

  const isSubmitting =
    createSample.isPending || updateSample.isPending || isFlushing;
  const closeDialog = () => {
    if (!isSubmitting) closeForm();
  };

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
        {!readOnly && !formDialog.open && (
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
      ) : !samples?.length && !formDialog.open ? (
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
                  <td className="py-8 pr-12">{formatDateTime(s.timestamp)}</td>
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
                          disabled={formDialog.open}
                        >
                          <PencilIcon size={16} />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => setDeletingId(s.id)}
                          aria-label="Delete sample"
                          disabled={formDialog.open}
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

      {!readOnly && (
        <QuickAddDialogShell
          isOpen={formDialog.open}
          onClose={closeDialog}
          title={
            formDialog.open && formDialog.sample
              ? "Edit Production Sample"
              : "Add Production Sample"
          }
          width="lg"
          testId="production-sample-dialog"
        >
          {formDialog.open && (
            <ProductionSampleForm
              key={formDialog.sample?.id ?? "create"}
              productionRunId={productionRunId}
              sample={formDialog.sample}
              onSubmit={handleSubmit}
              onCancel={closeDialog}
              isSubmitting={isSubmitting}
              errorMessage={formError ?? undefined}
              deferredAttachments={deferredAttachments}
              onRetryDeferredAttachment={handleRetryDeferredAttachments}
              onRemoveDeferredAttachment={handleRemoveDeferredAttachment}
            />
          )}
        </QuickAddDialogShell>
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
