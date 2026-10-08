"use client";

import { StaleVersionError, staleDeleteMessage } from "@/lib/stale-version";

import { useState } from "react";
import { PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { useToast } from "@/components/ui/toast";
import { ServerError } from "@/components/forms";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
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
import { hasAcceptedTransportEvidence } from "@/lib/certification/transport-evidence";
import type { TransportLeg } from "@/db/schema";
import { TransportLegForm } from "./transport-leg-form";
import { TransportRoute } from "./transport-route";
import {
  deriveTransportLegCertStatuses,
  summarizeTransportLegCertStatuses,
} from "./transport-leg-cert-status";

interface TransportLegsEditorProps {
  entityType: TransportEntityTypeValue;
  entityId: string;
  /** Override the route's accessible name. Defaults based on entityType. */
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

const MENU_ICON_PX = 16;
const ADD_ICON_PX = 16;

/**
 * Saved or deferred transport legs for an entity side sheet, drawn by
 * `TransportRoute` and, when editable, added, edited and deleted through a
 * centered dialog. Pass `readOnly` for the view-mode summary. A caller that
 * holds its own route values uses `TransportRoutePreview` instead.
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
    { savedId: string; expectedVersion: number } | { deferredIndex: number } | null
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
        await updateMutation.mutateAsync({ id: dialog.leg.id, expectedVersion: dialog.leg.version, ...data });
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
      await deleteMutation.mutateAsync({ id: deleteTarget.savedId, expectedVersion: deleteTarget.expectedVersion });
      toast.success("Transport leg deleted");
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(
        err instanceof StaleVersionError ? staleDeleteMessage("Transport leg") : err instanceof Error ? err.message : "Transport leg was not deleted. Try again.",
      );
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const displayedLegs: readonly EditableTransportLeg[] = deferred
    ? deferredLegs
    : (legs ?? []);
  const controlsDisabled = dialog.open || disabled;
  const certSummary = summarizeTransportLegCertStatuses(
    deriveTransportLegCertStatuses(deferred ? deferredLegs : legs, !deferred, entityType),
  );

  const evidenceFor = (index: number): boolean => {
    const leg = displayedLegs[index];
    return (
      !deferred &&
      isSavedTransportLeg(leg) &&
      hasAcceptedTransportEvidence(
        (leg as { transportEvidenceDocumentCount?: number })
          .transportEvidenceDocumentCount,
      )
    );
  };

  const actionsFor = (index: number) => {
    const leg = displayedLegs[index];
    return (
      <RowActionsMenu
        className="shrink-0"
        label={`Actions for leg ${index + 1}`}
        actions={[
          {
            label: "Edit",
            icon: <PencilSimpleIcon size={MENU_ICON_PX} />,
            onSelect: () => openEdit(leg, deferred ? index : undefined),
            disabled: controlsDisabled,
          },
          {
            label: "Delete",
            destructive: true,
            icon: <TrashIcon size={MENU_ICON_PX} />,
            onSelect: () =>
              setDeleteTarget(
                isSavedTransportLeg(leg) ? { savedId: leg.id, expectedVersion: leg.version } : { deferredIndex: index },
              ),
            disabled: controlsDisabled,
          },
        ]}
      />
    );
  };

  return (
    <div>
      <TransportRoute
        entityType={entityType}
        legs={displayedLegs}
        title={title}
        cert={certSummary}
        emptyMessage={
          emptyMessage ??
          (readOnly
            ? "No transport legs recorded yet."
            : 'No transport legs recorded yet. Click "Add transport leg" to record one.')
        }
        loading={!deferred && isLoading}
        error={
          !deferred && error
            ? error instanceof Error
              ? error.message
              : "The transport legs could not be loaded. Refresh the page and try again."
            : null
        }
        evidence={evidenceFor}
        actions={readOnly ? undefined : actionsFor}
        headerAction={
          readOnly ? undefined : (
            <Button
              type="button"
              variant="default"
              size="small"
              onClick={openCreate}
              disabled={controlsDisabled}
            >
              <PlusIcon size={ADD_ICON_PX} weight="bold" />
              Add transport leg
            </Button>
          )
        }
      />

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
