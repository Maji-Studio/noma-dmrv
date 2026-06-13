"use client";

import { useState } from "react";
import { Plus, Pencil, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import { useToast } from "@/components/ui/toast";
import { ServerError } from "@/components/forms";
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
import type { TransportLeg } from "@/db/schema";
import { TransportLegForm } from "./transport-leg-form";

interface TransportLegsEditorProps {
  entityType: TransportEntityTypeValue;
  entityId: string;
  /** Override the section title. Defaults based on entityType. */
  title?: string;
  /** Read-only: list legs without add/edit/delete affordances (view mode). */
  readOnly?: boolean;
  /** Override the no-legs message (e.g. for auto-derived categories). */
  emptyMessage?: string;
}

// Feedstock and biochar legs are auto-derived (supplier distance / delivery
// aggregation) and only ever rendered read-only; sample → lab stays manual.
const DEFAULT_TITLES: Record<TransportEntityTypeValue, string> = {
  feedstock: "Transport: feedstock → processing",
  biochar: "Transport: biochar distribution",
  sample: "Transport: sample → lab",
};

function formatMethod(method: string): string {
  const cleaned = method.replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Transport-leg management for the entity side sheet. Matches the production-run
 * child-entity pattern: a `border-t` section with an uppercase header + add
 * button, a compact table, and an inline (non-modal) add/edit form. Pass
 * `readOnly` for the view-mode summary.
 */
export function TransportLegsEditor({
  entityType,
  entityId,
  title,
  readOnly = false,
  emptyMessage,
}: TransportLegsEditorProps) {
  const { data: legs, isLoading, error } = useTransportLegsForEntity(
    entityType,
    entityId,
  );
  const createMutation = useCreateTransportLeg();
  const updateMutation = useUpdateTransportLeg(entityType, entityId);
  const deleteMutation = useDeleteTransportLeg(entityType, entityId);
  const toast = useToast();

  const [inlineForm, setInlineForm] = useState<
    { open: false } | { open: true; leg?: TransportLeg }
  >({ open: false });
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openCreate = () => {
    setFormError(null);
    setInlineForm({ open: true });
  };
  const openEdit = (leg: TransportLeg) => {
    setFormError(null);
    setInlineForm({ open: true, leg });
  };
  const closeForm = () => setInlineForm({ open: false });

  const handleSubmit = async (data: TransportLegFormData) => {
    setFormError(null);
    try {
      if (inlineForm.open && inlineForm.leg) {
        await updateMutation.mutateAsync({ id: inlineForm.leg.id, ...data });
        toast.success("Transport leg updated");
      } else {
        await createMutation.mutateAsync({ ...data, entityType, entityId });
        toast.success("Transport leg added");
      }
      closeForm();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to save transport leg",
      );
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingId) return;
    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync({ id: deletingId });
      toast.success("Transport leg deleted");
      setDeletingId(null);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to delete transport leg",
      );
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const showAddButton = !readOnly && !inlineForm.open;
  const hasLegs = !!legs && legs.length > 0;

  return (
    <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          {title ?? DEFAULT_TITLES[entityType]}
        </h3>
        {showAddButton && (
          <Button variant="default" size="small" onClick={openCreate}>
            <Plus size={16} weight="bold" />
            Add leg
          </Button>
        )}
      </div>

      {error && (
        <ServerError
          message={
            error instanceof Error ? error.message : "Failed to load transport legs"
          }
        />
      )}

      {/* Table */}
      {isLoading ? (
        <TableSkeleton columns={readOnly ? 4 : 5} rows={2} />
      ) : !hasLegs && !inlineForm.open ? (
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
                    <CertificationFieldTag />
                  </span>
                </th>
                <th className="py-8 pr-12 font-medium">Method</th>
                <th className="py-8 pr-12 font-medium">
                  <span className="flex items-center gap-6">
                    Load
                    <CertificationFieldTag />
                  </span>
                </th>
                {!readOnly && <th className="py-8 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {legs!.map((leg) => (
                <tr
                  key={leg.id}
                  className="border-b border-[var(--color-border-tertiary)] hover:bg-[var(--color-background-medium)]"
                >
                  <td className="py-8 pr-12 text-[var(--color-text-primary)]">
                    {(leg.originName?.trim() || "—") +
                      " → " +
                      (leg.destinationName?.trim() || "—")}
                  </td>
                  <td className="py-8 pr-12">
                    {leg.distanceKm} km
                    {leg.distanceSource && (
                      <span className="text-[var(--color-text-tertiary)]">
                        {" "}· {DISTANCE_SOURCE_LABELS[leg.distanceSource]}
                      </span>
                    )}
                  </td>
                  <td className="py-8 pr-12">{formatMethod(leg.transportMethodType)}</td>
                  <td className="py-8 pr-12">
                    {leg.loadMassKg != null ? formatMass(leg.loadMassKg) : "—"}
                  </td>
                  {!readOnly && (
                    <td className="py-8 text-right">
                      <div className="flex items-center justify-end gap-4">
                        <Button
                          variant="noOutline"
                          size="icon"
                          onClick={() => openEdit(leg)}
                          aria-label="Edit transport leg"
                          disabled={inlineForm.open}
                        >
                          <Pencil size={16} />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => setDeletingId(leg.id)}
                          aria-label="Delete transport leg"
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
            {inlineForm.leg ? "Edit transport leg" : "Add transport leg"}
          </h4>
          {formError && (
            <div className="mb-16">
              <ServerError message={formError} />
            </div>
          )}
          <TransportLegForm
            key={inlineForm.leg?.id ?? "create"}
            leg={inlineForm.leg}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            isSubmitting={isSubmitting}
          />
        </div>
      )}

      {/* Delete Confirmation */}
      {!readOnly && (
        <>
          {deleteError && <ServerError message={deleteError} />}
          <DeleteConfirmDialog
            isOpen={!!deletingId}
            title="Delete transport leg"
            message="This transport leg will be permanently removed. This cannot be undone."
            onConfirm={handleDeleteConfirm}
            onCancel={() => {
              setDeletingId(null);
              setDeleteError(null);
            }}
            isPending={deleteMutation.isPending}
          />
        </>
      )}
    </div>
  );
}
