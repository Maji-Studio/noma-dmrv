"use client";

import { useState } from "react";
import {
  AirplaneIcon,
  BoatIcon,
  PathIcon,
  PencilIcon,
  PipeIcon,
  PlusIcon,
  TrainIcon,
  TrashIcon,
  TruckIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
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
  TransportMethodValue,
} from "@/schemas/transport-legs";
import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import { hasAcceptedTransportEvidence } from "@/lib/certification/transport-evidence";
import type { TransportLeg } from "@/db/schema";
import { TransportLegForm } from "./transport-leg-form";
import {
  deriveTransportLegCertStatuses,
  summarizeTransportLegCertStatuses,
} from "./transport-leg-cert-status";

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
// Every mount already sits under a section header that says "Transport", so
// this names only the route category. It renders as a caption, never a heading,
// and doubles as the journey timeline's accessible name.
const DEFAULT_CATEGORY_LABELS: Record<TransportEntityTypeValue, string> = {
  feedstock: "Feedstock to processing",
  biochar: "Biochar distribution",
  sample: "Sample to lab",
};

// One glyph per stored transport method. The stored enum is wider than the
// selectable one (only road is offered until the Isometric blueprint binds the
// other emission factors), so every value keeps an icon and an unknown value
// still draws a route glyph rather than nothing.
const TRANSPORT_METHOD_ICONS: Record<TransportMethodValue, Icon> = {
  road: TruckIcon,
  rail: TrainIcon,
  ship: BoatIcon,
  pipeline: PipeIcon,
  aircraft: AirplaneIcon,
};
const FALLBACK_METHOD_ICON: Icon = PathIcon;

const METHOD_ICON_PX = 16;
const CONTROL_ICON_PX = 16;
const ADD_ICON_PX = 16;

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

/** One journey total under the final stop: label left, figure right. */
function JourneyTotal({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="border-t border-[var(--color-border-tertiary)] pt-6">
      <div className="flex items-baseline justify-between gap-8">
        <dt className="text-[var(--color-text-tertiary)]">{label}</dt>
        <dd className="tabular-nums text-[var(--color-text-secondary)]">
          {value}
        </dd>
      </div>
      {caption && (
        <p className="text-[var(--color-text-tertiary)]">{caption}</p>
      )}
    </div>
  );
}

function formatMethod(method: string): string {
  const cleaned = method.replace(/_/g, " ");
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Lower the label's first letter so it reads mid-sentence after the method. */
function formatDistanceSource(
  source: DistanceSourceValue | null | undefined,
): string {
  if (!source) return MISSING_VALUE.notRecorded;
  const label = DISTANCE_SOURCE_LABELS[source];
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function stopDisplayName(raw: string | null | undefined): string {
  return raw?.trim() || MISSING_VALUE.notRecorded;
}

/**
 * Identity used to decide whether a leg departs the stop the previous leg
 * arrived at. A named stop is identified by its name, an unnamed one by its
 * coordinates, and a stop with neither is never identified — two blank stops
 * are not evidence of one place, so they stay two nodes.
 */
function stopIdentity(
  name: string | null | undefined,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): string | null {
  const trimmed = name?.trim();
  if (trimmed) return trimmed.toLowerCase();
  if (latitude != null && longitude != null) return `${latitude},${longitude}`;
  return null;
}

interface JourneyStop {
  key: string;
  name: string;
  /** The leg departing this stop, when one does. The final stop has none. */
  leg?: EditableTransportLeg;
  /** That leg's index in the displayed list; deferred edit/delete need it. */
  legIndex?: number;
}

/**
 * Turn the leg list into the stops of one journey: the first leg's origin, then
 * every leg's destination. Consecutive legs share a stop, so a chain of two
 * legs renders three nodes. A leg whose origin is not the previous leg's
 * destination gets its own origin node, so a data mismatch stays visible
 * instead of collapsing into a route nobody recorded.
 */
function buildJourneyStops(
  legs: readonly EditableTransportLeg[],
): JourneyStop[] {
  const stops: JourneyStop[] = [];
  let previousDestination: string | null = null;

  legs.forEach((leg, index) => {
    const originIdentity = stopIdentity(
      leg.originName,
      leg.originGpsLatitude,
      leg.originGpsLongitude,
    );
    const previousStop = stops[stops.length - 1];
    const continuesRoute =
      previousStop !== undefined &&
      previousDestination !== null &&
      originIdentity !== null &&
      originIdentity === previousDestination;

    if (continuesRoute) {
      previousStop.leg = leg;
      previousStop.legIndex = index;
    } else {
      stops.push({
        key: `origin-${index}`,
        name: stopDisplayName(leg.originName),
        leg,
        legIndex: index,
      });
    }

    previousDestination = stopIdentity(
      leg.destinationName,
      leg.destinationGpsLatitude,
      leg.destinationGpsLongitude,
    );
    stops.push({
      key: `destination-${index}`,
      name: stopDisplayName(leg.destinationName),
    });
  });

  return stops;
}

interface JourneyTotals {
  /** Sum of every recorded leg distance. */
  distance: string;
  /** Names the legs the sum could not include, so the figure is never read as complete. */
  distanceCaption?: string;
  /**
   * The cargo moved along the journey. Consecutive legs move the same cargo, so
   * a sum would double-count it: a uniform load reads as one figure and a
   * varying one as the range the legs cover.
   */
  load: string;
}

function summarizeJourney(
  legs: readonly EditableTransportLeg[],
): JourneyTotals {
  const distances = legs
    .map((leg) => leg.distanceKm)
    .filter((km): km is number => km != null && Number.isFinite(km));
  const missingDistances = legs.length - distances.length;
  const loads = legs
    .map((leg) => leg.loadMassKg)
    .filter((kg): kg is number => kg != null && Number.isFinite(kg));

  const totalDistance =
    distances.length > 0
      ? formatDistanceKm(distances.reduce((sum, km) => sum + km, 0))
      : MISSING_VALUE.notRecorded;
  const distanceCaption =
    missingDistances > 0
      ? `${missingDistances} ${missingDistances === 1 ? "leg has" : "legs have"} no recorded distance.`
      : undefined;

  const minLoad = loads.length > 0 ? Math.min(...loads) : null;
  const maxLoad = loads.length > 0 ? Math.max(...loads) : null;
  const load =
    minLoad == null || maxLoad == null
      ? MISSING_VALUE.notRecorded
      : minLoad === maxLoad
        ? formatMass(minLoad)
        : `${formatMass(minLoad)} to ${formatMass(maxLoad)}`;

  return { distance: totalDistance, distanceCaption, load };
}

/**
 * The boxed segment between two stops: the mode it travelled, where its
 * distance came from, the distance itself, and its evidence. Distance
 * provenance and evidence stay on the box rather than behind a hover, because
 * both are certification facts an operator reads, not decoration.
 */
function JourneyLeg({
  leg,
  arrivalStopName,
  evidenceAttached,
  onEdit,
  onDelete,
  controlsDisabled,
  showControls,
}: {
  leg: EditableTransportLeg;
  arrivalStopName: string;
  evidenceAttached: boolean;
  onEdit: () => void;
  onDelete: () => void;
  controlsDisabled: boolean;
  showControls: boolean;
}) {
  const MethodIcon =
    TRANSPORT_METHOD_ICONS[leg.transportMethodType as TransportMethodValue] ??
    FALLBACK_METHOD_ICON;

  return (
    <div className="space-y-6 border border-[var(--color-border-tertiary)] p-8">
      <div className="flex items-start justify-between gap-8">
        <p className="flex min-w-0 items-start gap-6 body-small text-[var(--color-text-secondary)]">
          <MethodIcon
            size={METHOD_ICON_PX}
            className="mt-2 shrink-0 text-[var(--color-icon-secondary)]"
            aria-hidden
          />
          <span className="min-w-0">
            <span className="sr-only">{`Leg to ${arrivalStopName}. `}</span>
            {`${formatMethod(leg.transportMethodType)}, ${formatDistanceSource(leg.distanceSource)}`}
          </span>
        </p>
        <span className="shrink-0 body-small font-medium tabular-nums text-[var(--color-text-primary)]">
          {formatDistanceKm(leg.distanceKm)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-8">
        <dl className="body-caption">
          <LegFact
            label="Evidence"
            value={evidenceAttached ? "Attached" : MISSING_VALUE.none}
          />
        </dl>
        {showControls && (
          <div className="flex shrink-0 items-center gap-4">
            <Button
              type="button"
              variant="noOutline"
              size="icon"
              onClick={onEdit}
              aria-label="Edit transport leg"
              disabled={controlsDisabled}
            >
              <PencilIcon size={CONTROL_ICON_PX} />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={onDelete}
              aria-label="Delete transport leg"
              disabled={controlsDisabled}
            >
              <TrashIcon size={CONTROL_ICON_PX} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Transport-leg management for the entity side sheet: a `border-t` section with
 * a caption + add button, the legs as one journey timeline, and a centered
 * add/edit dialog. Pass `readOnly` for the view-mode summary.
 *
 * Every mount is a 390px side sheet, so the legs read as stops on a rail rather
 * than as a table: consecutive legs share a stop, which is what the operator
 * recorded, and each leg sits as a one-row box between the two stops it joins.
 * Long stop names wrap; the distance stays pinned right.
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
  const categoryLabel = title ?? DEFAULT_CATEGORY_LABELS[entityType];
  const stops = buildJourneyStops(displayedLegs);
  const totals = summarizeJourney(displayedLegs);
  const controlsDisabled = dialog.open || disabled;
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
            {categoryLabel}
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
            disabled={controlsDisabled}
          >
            <PlusIcon size={ADD_ICON_PX} weight="bold" />
            Add transport leg
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
              : 'No transport legs recorded yet. Click "Add transport leg" to record one.')}
        </p>
      ) : (
        <ol aria-label={`${categoryLabel} journey`}>
          {stops.map((stop, index) => {
            const isFinalStop = index === stops.length - 1;
            const leg = stop.leg;
            const arrivalStopName = stops[index + 1]?.name ?? stop.name;
            const evidenceAttached =
              leg !== undefined &&
              isSavedTransportLeg(leg) &&
              !deferred &&
              hasAcceptedTransportEvidence(
                (leg as { transportEvidenceDocumentCount?: number })
                  .transportEvidenceDocumentCount,
              );
            return (
              <li key={stop.key} className="flex gap-12">
                <div
                  className="flex flex-col items-center"
                  aria-hidden="true"
                >
                  <span className="mt-6 size-8 shrink-0 rounded-full bg-[var(--color-text-primary)]" />
                  {!isFinalStop && (
                    <span className="w-1 flex-1 bg-[var(--color-border-secondary)]" />
                  )}
                </div>
                <div
                  className={cn(
                    "min-w-0 flex-1 space-y-8",
                    !isFinalStop && "pb-16",
                  )}
                >
                  <p className="body-small font-medium text-[var(--color-text-primary)]">
                    {stop.name}
                  </p>
                  {leg && (
                    <JourneyLeg
                      leg={leg}
                      arrivalStopName={arrivalStopName}
                      evidenceAttached={evidenceAttached}
                      showControls={!readOnly}
                      controlsDisabled={controlsDisabled}
                      onEdit={() =>
                        openEdit(leg, deferred ? stop.legIndex : undefined)
                      }
                      onDelete={() =>
                        setDeleteTarget(
                          isSavedTransportLeg(leg)
                            ? { savedId: leg.id }
                            : { deferredIndex: stop.legIndex ?? 0 },
                        )
                      }
                    />
                  )}
                  {isFinalStop && (
                    <dl className="body-caption">
                      <JourneyTotal label="Load carried" value={totals.load} />
                      <JourneyTotal
                        label="Total distance"
                        value={totals.distance}
                        caption={totals.distanceCaption}
                      />
                    </dl>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
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
