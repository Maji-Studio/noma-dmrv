/**
 * DeliveryForm component
 * Reusable delivery form with React Hook Form integration
 * Dry biochar is allocated server-side from the linked product.
 */
"use client";

import { deliveryActionFieldIssues } from "@/lib/delivery-action-errors";
import { Notice } from "@/components/ui/notice";
import { deliveryAfterDistanceFill } from "@/lib/delivery-distance-refresh";
import { useDeliveryWithRelations } from "@/hooks/use-deliveries";
import { useDeliveryStockEdit } from "@/hooks/use-delivery-stock-edit";
import { DeliveryStockDetails } from "./delivery-stock-details";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import { nullableNumericValue } from "@/lib/form-utils";
import { useId, useState } from "react";

import { FormActions, FormEntitySelect, FormField, FormSection, FormSpine, makeCertFieldStatus, MoistureField, ResolvedErrorRevalidator, WetMassField } from "@/components/forms";
import { EventTimeInput } from "@/components/forms/event-time-input";
import { OutputStockPreview } from "@/components/storage-locations/output-stock-preview";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import { TransportRoutePreview } from "@/components/transport-legs";
import type { Delivery } from "@/db/schema";
import { useClearOnDependencyChange } from "@/hooks/use-clear-on-dependency-change";
import { DistanceOverrideField } from "@/components/transport-legs/distance-override-field";
import { DistanceDriftAction, SAVE_BEFORE_REFRESH_REASON } from "@/components/transport-legs/transport-distance-drift";
import { distanceOverridePatch, emptyToNullSource, hasSavedOverride, overrideDistanceError } from "@/components/transport-legs/distance-override";
import { customerLocationDistanceLink } from "@/lib/location-distance-links";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { useFacility } from "@/hooks/use-facilities";
import { useFacilityClock, useFacilityContext } from "@/hooks/use-facility-context";
import { useOrdersForSelect, useOrderWithRelations } from "@/hooks/use-orders";
import { useOutputDrawDraft } from "@/hooks/use-output-draw-draft";
import { useSubBinDraw } from "@/hooks/use-sub-bin-draw";
import { SubBinDrawField } from "@/components/storage-locations/sub-bin-draw-field";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";
import { STRICT_FORMULATION_MATCH } from "@/schemas/biochar-products";
import { deliveryFormSchema, type DeliveryFormData } from "@/schemas/deliveries";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarIcon, MapPinIcon, ScalesIcon } from "@phosphor-icons/react/dist/ssr";
import { useForm, useWatch } from "react-hook-form";
import { DeliveryEvidenceSection } from "./delivery-trailing-sections";

// ============================================
// Constants for select options
// ============================================

const SET_VALUE_OPTS = {
  shouldDirty: true,
  shouldTouch: true,
  shouldValidate: true,
} as const;

const ROUTE_EMPTY = "Select an order and enter the delivered wet mass to see the route.";

const isDeliveryCertifyField = (field: string) =>
  isCertifyFormField("delivery", field);

// ============================================
// Formatting helpers
// ============================================

// ============================================
// Component
// ============================================

interface DeliveryFormProps {
  /** Existing delivery data for editing (undefined for create mode) */
  delivery?: Delivery;
  /** Form submission handler */
  onSubmit: (data: DeliveryFormData, onError: (error: unknown) => boolean, expectedVersion?: number) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Submission-level error shown with the action footer */
  errorMessage?: string;
  /** Custom label for the submit button */
  submitLabel?: string;
  deferredAttachments?: UseDeferredAttachmentsResult;
  focusTarget?: EntityFocusTarget | null;
  /** A refresh from location saved a new version: reopen the form on it. */
  onDistanceRefreshed?: () => void;
}

export function DeliveryForm({ delivery, onSubmit, onCancel, isSubmitting = false, errorMessage, submitLabel, deferredAttachments, focusTarget, onDistanceRefreshed }: DeliveryFormProps) {
  const refreshedDelivery = useDeliveryWithRelations(delivery?.id ?? "");
  const distanceRecord = delivery ? deliveryAfterDistanceFill(delivery, refreshedDelivery.data) : undefined;
  const isEditMode = !!delivery;
  const stockEdit = useDeliveryStockEdit(delivery);
  const [openedMovement, setOpenedMovement] = useState(stockEdit.movement);
  if (!openedMovement && stockEdit.movement) setOpenedMovement(stockEdit.movement);
  // Date, mass and moisture post one stock correction, so one dependency check locks all three.
  const stockLocked = isEditMode && (!stockEdit.editable || (!!openedMovement && openedMovement.id !== stockEdit.movement?.id));
  const formId = useId();
  const { facilityId: contextFacilityId } = useFacilityContext();
  const formFacilityId = delivery?.facilityId ?? contextFacilityId;
  const deliveryClock = useFacilityClock(formFacilityId);
  const { data: formFacility } = useFacility(formFacilityId ?? "");

  // The order picker fetches its own options (FormEntitySelect); this query
  // only backs the stored-distance prefill for the selected order below.
  const { data: ordersData } = useOrdersForSelect(formFacilityId ?? undefined, {
    enabled: !!formFacilityId,
  });
  const orders = ordersData ?? [];
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const savedOverride = delivery
    ? { distanceKm: delivery.distanceKmOverride, source: delivery.distanceSource, note: delivery.distanceNote }
    : null;
  const [overriding, setOverriding] = useState(hasSavedOverride(savedOverride));

  const defaultValues = {
    idempotencyKey,
    correctsMovementId: undefined as string | undefined,
    basisFingerprint: "pending-preview",
    orderId: delivery?.orderId ?? "",
    deliveryDate: (delivery?.deliveryDate ? new Date(delivery.deliveryDate) : new Date()).toISOString(),
    status: "delivered" as const,
    // Match the registered empty values so focusing the header is not an edit.
    deliveredWetMassKg: delivery?.deliveredWetMassKg ?? null,
    moistureContentPercent: (delivery?.moistureContentPercent ?? "") as number | string | undefined,
    // Set on save for a split-bin load, from the sub-bin reading rows.
    sources: undefined as DeliveryFormData["sources"],
    storageLocationId: delivery?.storageLocationId ?? "",
    driverId: delivery?.driverId ?? undefined,
    vehicleId: delivery?.vehicleId ?? undefined,
    // Only an override is a form value; the derived distance is the recorded pair.
    distanceKmOverride: (hasSavedOverride(savedOverride) ? delivery?.distanceKmOverride : null) as number | null,
    distanceSource: (hasSavedOverride(savedOverride) ? delivery?.distanceSource : null) as DistanceSourceValue | null,
    distanceNote: delivery?.distanceNote ?? "",
  };

  const {
    register,
    control,
    trigger,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(deliveryFormSchema),
    // onTouched so spine markers can flag errors on blur, not only on submit.
    mode: "onTouched",
    defaultValues,
  });

  // CERT chips reflect the saved record (frozen), neutral while creating.
  const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);

  const watchWetMass = useWatch({ control, name: "deliveredWetMassKg" });
  const watchSources = useWatch({ control, name: "sources" });
  const watchMoisture = useWatch({ control, name: "moistureContentPercent" });
  const watchOrderId = useWatch({ control, name: "orderId" });
  const watchBinId = useWatch({ control, name: "storageLocationId" });
  const watchDate = useWatch({ control, name: "deliveryDate" });
  const distanceKmOverride = useWatch({
    control,
    name: "distanceKmOverride",
  }) as number | null | undefined;
  const draftDistanceSource = useWatch({ control, name: "distanceSource" });

  const selectedOrder = orders.find((o) => o.id === watchOrderId);
  // Clearing an override restores the recorded pair snapshot (GLOSSARY).
  const storedDistanceKm = distanceRecord ? distanceRecord.recordedDistanceKm ?? null : selectedOrder?.destinationDistanceKm ?? null;
  const storedDistanceSource = distanceRecord ? distanceRecord.recordedDistanceSource ?? null : selectedOrder?.destinationDistanceSource ?? null;

  // The trip's effective distance, resolved like the saved route: a delivery
  // can document the stored route without overriding its distance.
  const effectiveDistanceKm = overriding ? (distanceKmOverride ?? null) : storedDistanceKm;
  const effectiveDraftDistanceSource: DistanceSourceValue | null = overriding
    ? (draftDistanceSource ?? "manual")
    : delivery?.distanceSource === "document" ? "document" : storedDistanceSource;
  // The repair link needs the order's customer; load it only when the pair is missing.
  const { data: orderRelations } = useOrderWithRelations(watchOrderId ?? "", !!watchOrderId && storedDistanceKm == null);
  const customerLocationRepairHref = orderRelations && formFacilityId
    ? customerLocationDistanceLink({ facilityId: formFacilityId, partyId: orderRelations.customerId, locationId: orderRelations.customerLocationId })
    : null;

  const startOverride = () => {
    setOverriding(true);
    setValue("distanceKmOverride", null, SET_VALUE_OPTS);
    setValue("distanceSource", "manual", { shouldDirty: true });
  };
  const clearOverride = () => {
    setOverriding(false);
    clearErrors(["distanceKmOverride", "distanceSource", "distanceNote"]);
    setValue("distanceKmOverride", null, { shouldDirty: true });
    setValue("distanceSource", null, { shouldDirty: true });
    setValue("distanceNote", "", { shouldDirty: true });
  };

  // Switching orders invalidates a trip-specific override and its note.
  useClearOnDependencyChange(watchOrderId, () => {
    if (overriding) clearOverride();
  });

  const wetMass = Number(watchWetMass);
  const moisture = watchMoisture === "" || watchMoisture == null ? NaN : Number(watchMoisture);
  // A split product bin takes one reading per sub-bin the load reaches.
  const draw = useSubBinDraw({
    bin: !stockLocked && watchBinId && formFacilityId ? { storageLocationId: watchBinId, facilityId: formFacilityId } : null,
    occurredAt: watchDate ? String(watchDate) : null, wetKg: wetMass,
    correction: openedMovement ? { movementId: openedMovement.id, kind: "delivery", sources: openedMovement.sources } : undefined,
  });
  const [attempted, setAttempted] = useState(false);
  const dateChanged = isEditMode && !!watchDate && new Date(String(watchDate)).getTime() !== new Date(delivery.deliveryDate).getTime();
  const massChanged = isEditMode && (draw.changed || wetMass !== delivery.deliveredWetMassKg || (!draw.active && moisture !== delivery.moistureContentPercent) ||
    ((draw.sources ?? watchSources) != null && JSON.stringify(draw.sources ?? watchSources) !== JSON.stringify(openedMovement?.sources)));
  const stockChanged = !isEditMode || (!stockLocked && (massChanged || dateChanged));
  const { preview: stockPreview, estimate: moistureEstimate, gate, beginSubmit } = useOutputDrawDraft({
    draw, bypass: !stockChanged,
    singleMoistureReady: Number.isFinite(moisture) && moisture >= 0 && moisture < 100,
    moisturePercent: moisture,
    entry: watchBinId && watchDate && wetMass > 0 && Number.isFinite(wetMass)
      ? { storageLocationId: watchBinId, facilityId: formFacilityId ?? "", kind: "delivery", correctsMovementId: openedMovement?.id, occurredAt: String(watchDate), wetMassKg: wetMass }
      : null,
    estimateFor: { storageLocationId: watchBinId, facilityId: formFacilityId, occurredAt: watchDate ? String(watchDate) : null },
    // A split load saves its sub-bins and readings; its overall moisture is derived on save.
    writeReadings: (sources, split) => {
      if (!stockChanged) return;
      setValue("sources", sources);
      if (split) setValue("moistureContentPercent", undefined);
    },
  });
  const { canSave, submitDisabled: draftSubmitDisabled, basisFingerprint } = gate();
  const submitDisabled = draftSubmitDisabled || (stockLocked && (massChanged || dateChanged));
  useClearOnDependencyChange(watchOrderId, () => setValue("storageLocationId", ""));
  // A refusal caused by the new time alone belongs under the date, not the mass.
  const blockingMessage = stockPreview.data?.blockingMessage ?? undefined;
  const blockedByDate = dateChanged && !massChanged;
  const deliveryDateError = errors.deliveryDate?.message ?? (blockedByDate ? blockingMessage : undefined);
  const deliveredWetMassError = errors.deliveredWetMassKg?.message ?? errors.sources?.message ?? (blockedByDate ? undefined : blockingMessage);

  const defaultSubmitLabel = isEditMode ? "Update delivery" : "Create delivery";

  const submitDelivery = handleSubmit(async (data) => {
    if (!canSave || (stockLocked && (massChanged || dateChanged))) return;
    const submitted = { overriding, distanceKm: data.distanceKmOverride, source: data.distanceSource, note: data.distanceNote };
    const overrideError = overrideDistanceError(submitted);
    if (overrideError) {
      setError("distanceKmOverride", { type: "manual", message: overrideError }, { shouldFocus: true });
      return;
    }
    // The order is locked once saved; guard the baseline anyway, as the feedstock form does.
    const patch = distanceOverridePatch(savedOverride, submitted, { routeChanged: isEditMode && data.orderId !== delivery.orderId });
    const distanceFields = { distanceKmOverride: patch.distanceKm, distanceSource: patch.source, distanceNote: patch.note };
    // A failed save needs no refetch here: the host reports the error and the
    // mutation hooks invalidate `outputStockKeys.all`, which refreshes this preview.
    await onSubmit({ ...data, ...distanceFields, status: "delivered", idempotencyKey, basisFingerprint: basisFingerprint ?? "pending-preview", correctsMovementId: stockChanged ? openedMovement?.id : undefined,
      ...(isEditMode && !stockChanged ? { sources: undefined, deliveredWetMassKg: delivery.deliveredWetMassKg, moistureContentPercent: delivery.moistureContentPercent ?? undefined } : {}) } as DeliveryFormData, (error) => {
      const issues = deliveryActionFieldIssues(error, [
        "deliveryDate", "orderId", "storageLocationId", "deliveredWetMassKg",
        ...(stockLocked || draw.usesSingleMoisture ? ["moistureContentPercent" as const] : []),
        ...(overriding ? ["distanceKmOverride" as const, "distanceSource" as const, "distanceNote" as const] : []),
      ] as const);
      if (!issues) return false;
      issues.forEach((issue, index) => {
        setError(issue.field, { type: "server", message: issue.message }, { shouldFocus: index === 0 });
      });
      return true;
    }, distanceRecord?.version);
  });

  return (
    // The wrapper div absorbs the side-sheet Body's direct-child flex-col
    // override so the sticky CTA row keeps its own layout (see sample-form).
    <div className="space-y-20">
      <FormSpine control={control}>
      <form id={formId} onSubmit={(event) => {
        setAttempted(true);
        beginSubmit();
        return submitDelivery(event);
      }} className="space-y-20">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      {isEditMode && stockLocked && <Notice tone="info">{stockEdit.movement?.editLockedReason ?? (stockEdit.history.error ? "Stock edit availability could not be loaded. Reload this delivery." : stockEdit.movement ? "This delivery was corrected. Reload it before editing its date, mass or moisture." : "Loading stock edit availability...")}</Notice>}
      {/* Delivery Information Section */}
      <FormSection
        title="Delivery information"
        icon={<CalendarIcon size={14} weight="bold" />}
        fields={["deliveryDate", "orderId", "storageLocationId"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="deliveryDate" label="Delivery date and time" error={deliveryDateError} required cue={deliveryClock.hint}>
            <EventTimeInput control={control} name="deliveryDate" id="deliveryDate" timeZone={deliveryClock.timeZone} disabled={isSubmitting || stockLocked} />
          </FormField>

        </div>

        {/* Disabled until facility context resolves — an unscoped fetch would
            list other facilities' orders, and the stored-distance prefill
            below only covers the context facility's orders. */}
        <FormEntitySelect
          control={control}
          name="orderId"
          label="Order"
          entityType="order"
          allowEdit
          placeholder="Select order..."
          required
          showRemainingDryMass={false}
          disabled={isSubmitting || !formFacilityId}
          selectionLocked={isEditMode}
          filterBy={formFacilityId ? { facilityId: formFacilityId } : undefined}
          emptyHint={{
            message:
              "A delivery fulfils an order. Record the customer order first.",
            href: formFacilityId
              ? `/orders?facility=${encodeURIComponent(formFacilityId)}`
              : "/orders",
            linkLabel: "Open orders",
          }}
        />
        <FormEntitySelect
          id="storageLocationId"
          control={control}
          name="storageLocationId"
          label="Actual source bin"
          entityType="storageLocation"
          allowEdit
          placeholder="Select matching source bin..."
          required
          autoSelectSingle={false}
          disabled={isSubmitting}
          selectionLocked={isEditMode}
          filterBy={formFacilityId && selectedOrder?.formulationId ? {
            facilityId: formFacilityId,
            type: "product_bin",
            formulationId: selectedOrder.formulationId,
            formulationMatch: STRICT_FORMULATION_MATCH,
          } : { formulationMatch: STRICT_FORMULATION_MATCH }}
        />
      </FormSection>

      {/* Mass & Moisture Section */}
      <FormSection
        title="Mass and moisture"
        icon={<ScalesIcon size={14} weight="bold" />}
        fields={["deliveredWetMassKg", "moistureContentPercent"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <WetMassField
            id="deliveredWetMassKg"
            label="Biochar product wet mass"
            unit="kg"
            error={deliveredWetMassError}
            hint="Measured wet mass at departure, water included."
            required
            disabled={isSubmitting || stockLocked}
            placeholder="e.g. 1000"
            certifyRequired={isDeliveryCertifyField("deliveredWetMassKg")}
            certifyStatus={certStatus("deliveredWetMassKg")}
            registration={register("deliveredWetMassKg", {
              setValueAs: nullableNumericValue,
            })}
          />
          {(stockLocked || draw.usesSingleMoisture) && <MoistureField
            id="moistureContentPercent"
            label="Biochar product moisture"
            unit="%"
            error={errors.moistureContentPercent?.message}
            required
            disabled={isSubmitting || stockLocked}
            placeholder="e.g. 20"
            estimate={isEditMode ? undefined : moistureEstimate}
            reading={watchMoisture}
            registration={register("moistureContentPercent")}
          />}
          {/* The composition cards belong to the same grid as the two inputs
              above them, so they align to the field columns and inherit the
              row rhythm instead of stacking on a second spacing scale. The
              wrapper drops out while every child is hidden (before a bin and
              mass give a preview), so it adds no empty grid row under the inputs. */}
          <div className="md:col-span-2 space-y-16 [&:not(:has(>:not([hidden])))]:hidden">
            {draw.active && <SubBinDrawField draw={draw} timeZone={deliveryClock.timeZone} idPrefix="delivery" disabled={isSubmitting || stockLocked} showErrors={attempted} />}
            {draw.query.error && <p role="alert" className="body-caption text-[var(--color-status-error)]">{draw.query.error.message}</p>}
            {delivery && <DeliveryStockDetails deliveryId={delivery.id} storageLocationId={delivery.storageLocationId} wetMassKg={delivery.deliveredWetMassKg} dryMassKg={delivery.massDryKg} />}
            {stockPreview.isFetching && <p role="status" className="body-caption text-[var(--color-text-tertiary)]">Refreshing stock preview...</p>}
            {stockPreview.error && <p role="alert" className="body-caption text-[var(--color-status-error)]">{stockPreview.error.message}</p>}
            {stockPreview.data && <OutputStockPreview variant="movement" hideBlockingMessage={deliveredWetMassError === blockingMessage || deliveryDateError === blockingMessage} preview={stockPreview.data} entry={{ kind: "delivery", wetMassKg: wetMass }} />}
          </div>
        </div>
      </FormSection>

      {/* Transport Section */}
      <FormSection
        title="Transport"
        icon={<MapPinIcon size={14} weight="bold" />}
        fields={[
          "distanceKmOverride",
          "distanceSource",
          "distanceNote",
        ]}
      >
        <ActionableFocusTarget
          target="transport-route"
          activeTarget={focusTarget}
          actionLabel="Complete the saved transport route information"
        >
          <DistanceOverrideField
            id="distanceKmOverride"
            sourceId="distanceSource"
            noteId="distanceNote"
            hint="The one-way distance from this facility to the order's customer location. Override it when this trip took a different route."
            overriding={overriding}
            onOverride={startOverride}
            onClear={clearOverride}
            derived={{ distanceKm: storedDistanceKm, source: storedDistanceSource }}
            // A new delivery reads the pair from the order list; claim nothing until it loads.
            pending={!distanceRecord && !!watchOrderId && ordersData === undefined}
            locationName={selectedOrder?.destinationName ?? null}
            awaitingMessage={watchOrderId ? null : "Select an order to load the destination's distance."}
            repairHref={customerLocationRepairHref}
            footer={delivery && !hasSavedOverride(savedOverride) ? (
              <DistanceDriftAction
                target={{ entityType: "delivery", entityId: delivery.id }}
                recordCode={delivery.code}
                disabledReason={isDirty ? SAVE_BEFORE_REFRESH_REASON : null}
                onRefreshed={() => onDistanceRefreshed?.()}
              />
            ) : undefined}
            distanceRegistration={register("distanceKmOverride", { setValueAs: nullableNumericValue })}
            sourceRegistration={register("distanceSource", { setValueAs: emptyToNullSource })}
            noteRegistration={register("distanceNote")}
            source={draftDistanceSource}
            notePlaceholder="e.g., detour via the coastal road due to a bridge closure"
            errors={{
              distanceKm: errors.distanceKmOverride?.message,
              source: errors.distanceSource?.message,
              note: errors.distanceNote?.message,
            }}
            disabled={isSubmitting}
          />
        </ActionableFocusTarget>
        <TransportRoutePreview
          entityType="biochar"
          originName={formFacility?.name}
          destinationName={selectedOrder?.destinationName}
          originPoint={{ lat: formFacility?.gpsLatitude ?? null, lng: formFacility?.gpsLongitude ?? null }}
          destinationPoint={{ lat: selectedOrder?.destinationGpsLatitude ?? null, lng: selectedOrder?.destinationGpsLongitude ?? null }}
          distanceKm={effectiveDistanceKm}
          distanceSource={effectiveDraftDistanceSource}
          loadMassKg={typeof watchWetMass === "number" ? watchWetMass : null}
          saved={isEditMode}
          emptyMessage={ROUTE_EMPTY}
        />
      </FormSection>

      </form>

      <DeliveryEvidenceSection
        delivery={delivery}
        isEditMode={isEditMode}
        deferredAttachments={deferredAttachments}
        isSubmitting={isSubmitting}
        focusTarget={focusTarget}
      />
      </FormSpine>

      <FormActions
        control={control}
        formId={formId}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitDisabled={submitDisabled}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </div>
  );
}
