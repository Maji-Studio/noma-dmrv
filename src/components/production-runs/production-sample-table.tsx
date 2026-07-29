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
  if (v == null) return "Not recorded";
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
    entityNoun: "In-process measurement",
    executeCreate: async (data: ProductionSampleFormData) => {
      const sample = await createSample.mutateAsync(data);
      return { entities: [sample], result: sample };
    },
    setError: setFormError,
    setUpdateError: setFormError,
    getCreateErrorMessage: (error) =>
      error instanceof Error ? error.message : "The in-process measurement was not saved. Try again.",
    unresolvedUpdateMessage:
      "Resolve or remove the failed attachments before saving this in-process measurement.",
    openEditOnFailure: (sample) =>
      setFormDialog({ open: true, sample }),
    closeOnSuccess: () => closeForm(),
    onSuccess: () => toast.success("In-process measurement added."),
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
      toast.success("In-process measurement updated.");
      closeForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "The in-process measurement was not saved. Try again.");
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    try {
      await deleteSample.mutateAsync(deletingId);
      setDeletingId(null);
      toast.success("In-process measurement deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The in-process measurement was not deleted. Try again.");
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
          In-process measurements
        </h3>
        {!readOnly && !formDialog.open && (
          <Button variant="default" size="small" onClick={openCreate}>
            <PlusIcon size={16} weight="bold" />
            Add measurement
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
            ? "No in-process measurements recorded."
            : "Record field measurements taken during the production run."}
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
                    {s.sampleCode ?? "Not recorded"}
                  </td>
                  <td className="py-8 pr-12">{formatDateTime(s.timestamp)}</td>
                  <td className="py-8 pr-12">{formatNum(s.temperatureC, "\u00B0C")}</td>
                  <td className="py-8 pr-12">{formatNum(s.weightGrams, "g")}</td>
                  <td className="py-8 pr-12">{formatNum(s.moistureContentPercent, "%")}</td>
                  <td className="py-8 pr-12">{formatNum(s.fixedCarbonPercent, "%")}</td>
                  <td className="py-8 pr-12">{s.operatorName ?? "Not recorded"}</td>
                  {!readOnly && (
                    <td className="py-8 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <Button
                          variant="noOutline"
                          size="icon"
                          onClick={() => openEdit(s)}
                          aria-label="Edit in-process measurement"
                          disabled={formDialog.open}
                        >
                          <PencilIcon size={16} />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => setDeletingId(s.id)}
                          aria-label="Delete in-process measurement"
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
              ? "Edit in-process measurement"
              : "Add in-process measurement"
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
          title="Delete in-process measurement"
          message="Delete this in-process measurement? This action cannot be undone."
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingId(null)}
          isPending={deleteSample.isPending}
        />
      )}
    </div>
  );
}
