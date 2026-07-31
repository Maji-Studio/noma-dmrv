"use client";

import { useState } from "react";
import { PlusIcon, PencilIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import { useToast } from "@/components/ui/toast";
import { ServerError } from "@/components/forms";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { TableSkeleton } from "@/components/ui/loading-skeleton";
import { formatMass } from "@/lib/format-utils";
import {
  useCreateTransportLeg,
  useDeleteTransportLeg,
  useTransportLegsForEntity,
  useUpdateTransportLeg,
} from "@/hooks/use-transport-legs";
import type {
  TransportEntityTypeValue,
  TransportLegFormData,
} from "@/schemas/transport-legs";
import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";
import { hasAcceptedTransportEvidence } from "@/lib/certification/transport-evidence";
import type { TransportLeg } from "@/db/schema";
import { TransportLegForm } from "./transport-leg-form";
import { deriveTransportLegCertStatuses } from "./transport-leg-cert-status";

interface TransportLegsEditorProps {
  entityType: TransportEntityTypeValue;
  entityId: string;
  /** Override the section title. Defaults based on entityType. */
  title?: string;
  /** Read-only: list legs without add/edit/delete affordances (view mode). */
  readOnly?: boolean;
  /** Override the no-legs message (e.g. for auto-derived categories). */
  emptyMessage?: string;
  /** Hold legs in parent state instead of persisting them immediately. */
  deferred?: boolean;
  deferredLegs?: TransportLegFormData[];
  onDeferredChange?: (legs: TransportLegFormData[]) => void;
  /**
   * External busy signal (e.g. the parent form is submitting/flushing). Blocks
   * add/edit/delete so deferred legs cannot be mutated while a create is
   * iterating an older snapshot and its completion handler is about to
   * overwrite them.
   */
  disabled?: boolean;
}

type EditableTransportLeg = TransportLeg | TransportLegFormData;
type TransportLegDialogState = {
  open: boolean;
  leg?: EditableTransportLeg;
  deferredIndex?: number;
};

function isSavedTransportLeg(
  leg: EditableTransportLeg,
): leg is TransportLeg {
  return "id" in leg;
}

// Feedstock and biochar legs are auto-derived (supplier distance / delivery
// aggregation) and only ever rendered read-only; sample → lab stays manual.
const DEFAULT_TITLES: Record<TransportEntityTypeValue, string> = {
  feedstock: "Transport: feedstock to processing",
  biochar: "Transport: biochar distribution",
  sample: "Transport: Sample to lab",
};

function formatMethod(method: string): string {
  const cleaned = method.replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Transport-leg management for the entity side sheet. Matches the production-run
 * child-entity pattern: a `border-t` section with an uppercase header + add
 * button, a compact table, and a centered add/edit dialog. Pass `readOnly` for
 * the view-mode summary.
 */
export function TransportLegsEditor({
  entityType,
  entityId,
  title,
  readOnly = false,
  emptyMessage,
  deferred = false,
  deferredLegs = [],
  onDeferredChange,
  disabled = false,
}: TransportLegsEditorProps) {
  // `readOnly` and `deferred` are intentionally separate modes. Callers should
  // not combine them: deferred legs only exist while a create form is editable.
  const { data: legs, isLoading, error } = useTransportLegsForEntity(
    entityType,
    entityId,
    { enabled: !deferred },
  );
  const createMutation = useCreateTransportLeg();
  const updateMutation = useUpdateTransportLeg(entityType, entityId);
  const deleteMutation = useDeleteTransportLeg(entityType, entityId);
  const toast = useToast();

  const [dialog, setDialog] = useState<TransportLegDialogState>({ open: false });
  const [deleteTarget, setDeleteTarget] = useState<
    { savedId: string } | { deferredIndex: number } | null
  >(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openCreate = () => {
    setFormError(null);
    setDialog({ open: true });
  };
  const openEdit = (leg: EditableTransportLeg, deferredIndex?: number) => {
    setFormError(null);
    setDialog({ open: true, leg, deferredIndex });
  };
  const closeDialog = () => {
    // Preserve the selected leg while Base UI plays the close animation so the
    // dialog title and form do not switch from Edit to Add mid-transition.
    setDialog((current) => ({ ...current, open: false }));
  };

  const handleSubmit = async (data: TransportLegFormData) => {
    if (disabled) return;
    setFormError(null);

    if (deferred) {
      const nextLegs =
        dialog.deferredIndex !== undefined
          ? deferredLegs.map((leg, index) =>
              index === dialog.deferredIndex ? data : leg,
            )
          : [...deferredLegs, data];
      onDeferredChange?.(nextLegs);
      closeDialog();
      return;
    }

    try {
      if (
        dialog.leg &&
        isSavedTransportLeg(dialog.leg)
      ) {
        await updateMutation.mutateAsync({ id: dialog.leg.id, ...data });
        toast.success("Transport leg updated");
      } else {
        await createMutation.mutateAsync({ ...data, entityType, entityId });
        toast.success("Transport leg added");
      }
      closeDialog();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Transport leg was not saved. Try again.",
      );
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || disabled) return;
    setDeleteError(null);

    if ("deferredIndex" in deleteTarget) {
      onDeferredChange?.(
        deferredLegs.filter((_, index) => index !== deleteTarget.deferredIndex),
      );
      setDeleteTarget(null);
      return;
    }

    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.savedId });
      toast.success("Transport leg deleted");
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Transport leg was not deleted. Try again.",
      );
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const showAddButton = !readOnly;
  const displayedLegs: EditableTransportLeg[] = deferred
    ? deferredLegs
    : (legs ?? []);
  const hasLegs = displayedLegs.length > 0;
  const certStatuses = deriveTransportLegCertStatuses(
    deferred ? deferredLegs : legs,
    !deferred,
  );

  return (
    <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          {title ?? DEFAULT_TITLES[entityType]}
        </h3>
        {showAddButton && (
          <Button
            type="button"
            variant="default"
            size="small"
            onClick={openCreate}
            disabled={dialog.open || disabled}
          >
            <PlusIcon size={16} weight="bold" />
            Add leg
          </Button>
        )}
      </div>

      {!deferred && error && (
        <ServerError
          message={
            error instanceof Error ? error.message : "The transport legs could not be loaded. Refresh the page and try again."
          }
        />
      )}

      {/* Table */}
      {!deferred && isLoading ? (
        <TableSkeleton columns={readOnly ? 6 : 7} rows={2} />
      ) : !hasLegs ? (
        <p className="body-small text-[var(--color-text-tertiary)] py-16">
          {emptyMessage ??
            (readOnly
              ? "No transport legs recorded yet."
              : 'No transport legs recorded yet. Click "Add leg" to record one.')}
        </p>
      ) : hasLegs ? (
        <div className="overflow-x-auto">
          <table className="w-full body-small">
            <thead>
              <tr className="border-b border-[var(--color-border-primary)] text-left text-[var(--color-text-tertiary)]">
                <th className="py-8 pr-12 font-medium">Route</th>
                <th className="py-8 pr-12 font-medium">
                  <span className="flex items-center gap-6">
                    Distance
                    <CertificationFieldTag status={certStatuses.distance} />
                  </span>
                </th>
                <th className="py-8 pr-12 font-medium">
                  <span className="flex items-center gap-6">
                    Distance source
                    <CertificationFieldTag
                      status={certStatuses.provenance}
                      description="Satisfied when the saved leg records its distance provenance"
                    />
                  </span>
                </th>
                <th className="py-8 pr-12 font-medium">Evidence</th>
                <th className="py-8 pr-12 font-medium">Method</th>
                <th className="py-8 pr-12 font-medium">
                  <span className="flex items-center gap-6">
                    Load
                    <CertificationFieldTag status={certStatuses.load} />
                  </span>
                </th>
                {!readOnly && <th className="py-8 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {displayedLegs.map((leg, index) => (
                <tr
                  key={isSavedTransportLeg(leg) ? leg.id : `deferred-${index}`}
                  className="border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-background-medium)]"
                >
                  <td className="py-8 pr-12 text-[var(--color-text-primary)]">
                    {(leg.originName?.trim() || "Not recorded") +
                      " → " +
                      (leg.destinationName?.trim() || "Not recorded")}
                  </td>
                  <td className="py-8 pr-12">
                    {leg.distanceKm} km
                  </td>
                  <td className="py-8 pr-12 text-[var(--color-text-secondary)]">
                    {leg.distanceSource
                      ? DISTANCE_SOURCE_LABELS[leg.distanceSource]
                      : "Not recorded"}
                  </td>
                  <td className="py-8 pr-12 text-[var(--color-text-secondary)]">
                    {isSavedTransportLeg(leg) &&
                    !deferred &&
                    hasAcceptedTransportEvidence(
                      (leg as { transportEvidenceDocumentCount?: number })
                        .transportEvidenceDocumentCount,
                    )
                      ? "Attached"
                      : "None"}
                  </td>
                  <td className="py-8 pr-12">{formatMethod(leg.transportMethodType)}</td>
                  <td className="py-8 pr-12">
                    {leg.loadMassKg != null ? formatMass(leg.loadMassKg) : "Not recorded"}
                  </td>
                  {!readOnly && (
                    <td className="py-8 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <Button
                          type="button"
                          variant="noOutline"
                          size="icon"
                          onClick={() =>
                            openEdit(leg, deferred ? index : undefined)
                          }
                          aria-label="Edit transport leg"
                          disabled={dialog.open || disabled}
                        >
                          <PencilIcon size={16} />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          onClick={() =>
                            setDeleteTarget(
                              isSavedTransportLeg(leg)
                                ? { savedId: leg.id }
                                : { deferredIndex: index },
                            )
                          }
                          aria-label="Delete transport leg"
                          disabled={dialog.open || disabled}
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
          isOpen={dialog.open}
          onClose={closeDialog}
          title={dialog.leg ? "Edit transport leg" : "Add transport leg"}
          width="xl"
          testId="transport-leg-dialog"
        >
          <TransportLegForm
            key={
              dialog.leg && isSavedTransportLeg(dialog.leg)
                ? dialog.leg.id
                : dialog.deferredIndex !== undefined
                  ? `deferred-${dialog.deferredIndex}`
                  : "create"
            }
            leg={dialog.leg}
            onSubmit={handleSubmit}
            onCancel={closeDialog}
            isSubmitting={isSubmitting || disabled}
            errorMessage={formError ?? undefined}
          />
        </QuickAddDialogShell>
      )}

      {/* Delete Confirmation */}
      {!readOnly && (
        <>
          {deleteError && <ServerError message={deleteError} />}
          <DeleteConfirmDialog
            isOpen={deleteTarget !== null}
            title="Delete transport leg"
            message="This transport leg will be permanently removed. This cannot be undone."
            onConfirm={handleDeleteConfirm}
            onCancel={() => {
              setDeleteTarget(null);
              setDeleteError(null);
            }}
            isPending={deleteMutation.isPending}
          />
        </>
      )}
    </div>
  );
}
