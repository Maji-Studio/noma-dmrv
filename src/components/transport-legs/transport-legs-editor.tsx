"use client";

import { useFormDetailLevel } from "@/components/forms/form-detail-context";
import { useState } from "react";
import {
  ArrowRightIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import { useToast } from "@/components/ui/toast";
import { ServerError } from "@/components/forms";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { formatDistanceKm, formatMass } from "@/lib/format-utils";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { cn } from "@/lib/utils";
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
import {
  deriveTransportLegCertStatuses,
  summarizeTransportLegCertStatuses,
} from "./transport-leg-cert-status";

interface TransportLegsEditorProps {
  followFormDetail?: boolean;
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
// Every mount already sits under a section header that says "Transport", so
// this names only the route category and renders as a caption, never a heading.
const DEFAULT_CATEGORY_LABELS: Record<TransportEntityTypeValue, string> = {
  feedstock: "Feedstock to processing",
  biochar: "Biochar distribution",
  sample: "Sample to lab",
};

/**
 * One label/value pair in a leg's caption row. Wrapping happens between pairs,
 * never inside one, so no fact ever breaks to one word per line.
 */
function LegFact({
  label,
  value,
  numeric = false,
}: {
  label: string;
  value: string;
  numeric?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-4">
      <dt className="text-[var(--color-text-tertiary)]">{label}</dt>
      <dd
        className={cn(
          "text-[var(--color-text-secondary)]",
          numeric && "tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function formatMethod(method: string): string {
  const cleaned = method.replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Transport-leg management for the entity side sheet: a `border-t` section with
 * a caption + add button, one stacked block per leg, and a centered add/edit
 * dialog. Pass `readOnly` for the view-mode summary.
 *
 * The legs are stacked rather than tabulated because every mount is a 390px
 * side sheet. A five-column table there collapsed the route column to one word
 * per line; a block whose first line is the route and whose second is a wrapping
 * caption of label/value pairs reads at any width.
 */
export function TransportLegsEditor({
  entityType,
  entityId,
  title,
  readOnly = false,
  followFormDetail = false,
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
  const detailLevel = useFormDetailLevel();
  // The detail toggle only exists where the surface opts into it; everywhere
  // else (edit mode, the derived feedstock/biochar lists) provenance is part of
  // the record the operator came to read.
  const showDistanceSource = !followFormDetail || detailLevel === "detailed";
  const showAddButton = !readOnly;
  const displayedLegs: EditableTransportLeg[] = deferred
    ? deferredLegs
    : (legs ?? []);
  const hasLegs = displayedLegs.length > 0;
  const certSummary = summarizeTransportLegCertStatuses(
    deriveTransportLegCertStatuses(
      deferred ? deferredLegs : legs,
      !deferred,
      entityType,
    ),
  );

  return (
    <div className="space-y-16 pt-16 border-t border-[var(--color-border-tertiary)]">
      {/* Header: a caption, not a heading. The surrounding section already
          carries the "Transport" title on the page's heading ladder. */}
      <div className="flex flex-wrap items-center justify-between gap-8">
        <div className="flex flex-wrap items-center gap-8">
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {title ?? DEFAULT_CATEGORY_LABELS[entityType]}
          </span>
          <CertificationFieldTag
            status={certSummary.status}
            description={certSummary.description}
          />
        </div>
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

      {!deferred && isLoading ? (
        <div className="space-y-12" aria-label="Loading transport legs">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-16 w-1/2" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !hasLegs ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          {emptyMessage ??
            (readOnly
              ? "No transport legs recorded yet."
              : 'No transport legs recorded yet. Click "Add leg" to record one.')}
        </p>
      ) : (
        <ul className="border-t border-[var(--color-border-tertiary)]">
          {displayedLegs.map((leg, index) => {
            const evidenceAttached =
              isSavedTransportLeg(leg) &&
              !deferred &&
              hasAcceptedTransportEvidence(
                (leg as { transportEvidenceDocumentCount?: number })
                  .transportEvidenceDocumentCount,
              );
            return (
              <li
                key={isSavedTransportLeg(leg) ? leg.id : `deferred-${index}`}
                className="flex items-start justify-between gap-12 border-b border-[var(--color-border-tertiary)] py-12"
              >
                <div className="min-w-0 flex-1 space-y-6">
                  <div className="flex flex-wrap items-center gap-x-8 gap-y-2 body-small font-medium text-[var(--color-text-primary)]">
                    <span>
                      {leg.originName?.trim() || MISSING_VALUE.notRecorded}
                    </span>
                    <ArrowRightIcon
                      size={14}
                      weight="bold"
                      className="shrink-0 text-[var(--color-icon-secondary)]"
                      aria-hidden
                    />
                    <span className="sr-only">to</span>
                    <span>
                      {leg.destinationName?.trim() || MISSING_VALUE.notRecorded}
                    </span>
                  </div>
                  <dl className="flex flex-wrap gap-x-16 gap-y-4 body-caption">
                    <LegFact
                      label="Distance"
                      numeric
                      value={formatDistanceKm(leg.distanceKm)}
                    />
                    {showDistanceSource && (
                      <LegFact
                        label="Distance source"
                        value={
                          leg.distanceSource
                            ? DISTANCE_SOURCE_LABELS[leg.distanceSource]
                            : MISSING_VALUE.notRecorded
                        }
                      />
                    )}
                    <LegFact
                      label="Method"
                      value={formatMethod(leg.transportMethodType)}
                    />
                    <LegFact
                      label="Load"
                      numeric
                      value={formatMass(leg.loadMassKg)}
                    />
                    <LegFact
                      label="Evidence"
                      value={
                        evidenceAttached ? "Attached" : MISSING_VALUE.none
                      }
                    />
                  </dl>
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 items-center gap-4">
                    <Button
                      type="button"
                      variant="noOutline"
                      size="icon"
                      onClick={() => openEdit(leg, deferred ? index : undefined)}
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
                )}
              </li>
            );
          })}
        </ul>
      )}

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
