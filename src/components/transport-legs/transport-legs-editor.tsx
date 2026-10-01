"use client";

import { useState } from "react";
import { PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { useToast } from "@/components/ui/toast";
import { ServerError } from "@/components/forms";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Skeleton } from "@/components/ui/loading-skeleton";
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
import { TransportJourney } from "./transport-journey";
import { buildJourney, type JourneyLegInput } from "./transport-journey-model";
import { TransportRouteMapButton } from "./transport-route-map";
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
  /**
   * Draw these legs instead of fetching saved ones: a read-only route the
   * caller builds from its own values (a delivery, or a form being edited).
   * Implies `readOnly`.
   */
  previewLegs?: readonly JourneyLegInput[];
  /** The preview reflects saved values, so its CERT chip may resolve. */
  previewSaved?: boolean;
  /** Evidence state for the preview legs; left out, the evidence icon is hidden. */
  previewEvidenceAttached?: boolean;
  /** A route before any goods move (an order) has no load to show. */
  hideLoad?: boolean;
  /**
   * Show the route's CERT chip on its label. Forms leave it off: their
   * distance and mass inputs carry their own chips.
   */
  certTag?: boolean;
}

type EditableTransportLeg = TransportLeg | TransportLegFormData;
type TransportLegDialogState = {
  open: boolean;
  leg?: EditableTransportLeg;
  deferredIndex?: number;
};

function isSavedTransportLeg(
  leg: EditableTransportLeg | JourneyLegInput,
): leg is TransportLeg {
  return "id" in leg;
}

// Feedstock and biochar legs are auto-derived (supplier distance / delivery
// aggregation) and only ever rendered read-only; sample → lab stays manual.
// The visible label is "Route"; this names the route for screen readers.
const DEFAULT_CATEGORY_LABELS: Record<TransportEntityTypeValue, string> = {
  feedstock: "Feedstock to processing",
  biochar: "Biochar distribution",
  sample: "Sample to lab",
};

const MENU_ICON_PX = 16;
const ADD_ICON_PX = 16;

/**
 * Transport legs for an entity side sheet: a "Route" label with its CERT
 * chip, the legs on the route rail (`TransportJourney`), a map for a single
 * leg and, when editable, add/edit/delete through a centered dialog. Pass
 * `readOnly` for the view-mode summary, `previewLegs` to draw a caller's
 * values instead of saved rows.
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
  previewLegs,
  previewSaved = false,
  previewEvidenceAttached,
  hideLoad = false,
  certTag = true,
}: TransportLegsEditorProps) {
  // `readOnly` and `deferred` are intentionally separate modes. Callers should
  // not combine them: deferred legs only exist while a create form is editable.
  const preview = previewLegs !== undefined;
  const fetchesSaved = !deferred && !preview;
  const { data: legs, isLoading, error } = useTransportLegsForEntity(
    entityType,
    entityId,
    { enabled: fetchesSaved },
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
  const isReadOnly = readOnly || preview;
  const showAddButton = !isReadOnly;
  const displayedLegs: readonly (EditableTransportLeg | JourneyLegInput)[] = preview
    ? previewLegs
    : deferred
      ? deferredLegs
      : (legs ?? []);
  const hasLegs = displayedLegs.length > 0;
  const categoryLabel = title ?? DEFAULT_CATEGORY_LABELS[entityType];
  const journey = buildJourney(displayedLegs, { hideLoad });
  const mapLeg = journey.legs.length === 1 ? journey.legs[0] : null;
  const controlsDisabled = dialog.open || disabled;
  const certSummary = summarizeTransportLegCertStatuses(
    deriveTransportLegCertStatuses(
      preview ? previewLegs : deferred ? deferredLegs : legs,
      preview ? previewSaved : !deferred,
      entityType,
    ),
  );

  const evidenceFor = (index: number): boolean | undefined => {
    if (preview) return previewEvidenceAttached;
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
    // Only editable mounts reach here, where every displayed leg is a saved
    // row or a deferred form value.
    const leg = displayedLegs[index] as EditableTransportLeg;
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
                isSavedTransportLeg(leg) ? { savedId: leg.id } : { deferredIndex: index },
              ),
            disabled: controlsDisabled,
          },
        ]}
      />
    );
  };

  return (
    <div className="space-y-8">
      {/* Reads as a field label in the step, not a heading: the step title
          already sits on the page's heading ladder. */}
      <div className="flex flex-wrap items-center justify-between gap-8">
        <span className="flex items-center gap-6 body-small text-[var(--color-text-secondary)]">
          Route
          {certTag && (
            <CertificationFieldTag
              status={certSummary.status}
              description={certSummary.description}
            />
          )}
        </span>
        <span className="flex items-center gap-8">
          {mapLeg && <TransportRouteMapButton leg={mapLeg} entityType={entityType} />}
          {showAddButton && (
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
          )}
        </span>
      </div>

      {fetchesSaved && error && (
        <ServerError
          message={
            error instanceof Error ? error.message : "The transport legs could not be loaded. Refresh the page and try again."
          }
        />
      )}

      {fetchesSaved && isLoading ? (
        <div className="space-y-12" aria-label="Loading transport legs">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-16 w-1/2" />
        </div>
      ) : !hasLegs ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          {emptyMessage ??
            (isReadOnly
              ? "No transport legs recorded yet."
              : 'No transport legs recorded yet. Click "Add transport leg" to record one.')}
        </p>
      ) : (
        <TransportJourney
          journey={journey}
          label={`${categoryLabel} journey`}
          evidence={evidenceFor}
          actions={isReadOnly ? undefined : actionsFor}
        />
      )}

      {!isReadOnly && (
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
      {!isReadOnly && (
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
