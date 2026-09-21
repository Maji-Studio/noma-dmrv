/**
 * DeliveryForm component
 * Reusable delivery form with React Hook Form integration
 * Dry biochar is allocated server-side from the linked product.
 */
"use client";

import { DeliveryStockDetails } from "./delivery-stock-details";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import { toDateInputValue } from "@/lib/date-utils";
import { nullableNumericValue } from "@/lib/form-utils";
import { useEffect, useId, useState } from "react";

import { FormActions, FormEntitySelect, FormField, FormInput, FormSection, FormSpine, FormTextarea, makeCertFieldStatus, MoistureField, ResolvedErrorRevalidator, WetMassField } from "@/components/forms";
import { formatDistance, parseDistanceDraft } from "@/components/forms/distance-calc-field";
import { FormSelect } from "@/components/forms/form-select";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { OutputStockPreview } from "@/components/storage-locations/output-stock-preview";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import type { Delivery } from "@/db/schema";
import { useClearOnDependencyChange } from "@/hooks/use-clear-on-dependency-change";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useOrdersForSelect } from "@/hooks/use-orders";
import { useOrganizationDefaultValues } from "@/hooks/use-organization-settings";
import { useMatchingOutputBins, useOutputStockPreview } from "@/hooks/use-output-stock";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";
import { deliveryFormSchema, type DeliveryFormData } from "@/schemas/deliveries";
import {
  DISTANCE_SOURCE_LABELS,
  type DistanceSourceValue,
} from "@/schemas/distance-source";
import { TRIP_TYPE_OPTIONS } from "@/schemas/trip-type";
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
  onSubmit: (data: DeliveryFormData) => Promise<void> | void;
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
}

export function DeliveryForm({ delivery, onSubmit, onCancel, isSubmitting = false, errorMessage, submitLabel, deferredAttachments, focusTarget }: DeliveryFormProps) {
  const isEditMode = !!delivery;
  const formId = useId();
  const { facilityId: contextFacilityId } = useFacilityContext();
  const formFacilityId = delivery?.facilityId ?? contextFacilityId;
  // Organization operating defaults seed create mode only; an existing record
  // always wins. Warmed once per session in FacilityProvider, so this is a
  // cache read rather than a round trip on open.
  const { defaults: orgDefaults } = useOrganizationDefaultValues();


  // The order picker fetches its own options (FormEntitySelect); this query
  // only backs the stored-distance prefill for the selected order below.
  const { data: ordersData } = useOrdersForSelect(formFacilityId ?? undefined, {
    enabled: !!formFacilityId,
  });
  const orders = ordersData ?? [];
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const defaultValues = {
    idempotencyKey,
    basisFingerprint: "pending-preview",
    orderId: delivery?.orderId ?? "",
    deliveryDate: toDateInputValue(delivery?.deliveryDate),
    status: "delivered" as const,
    // Match the registered empty values so focusing the header is not an edit.
    deliveredWetMassKg: delivery?.deliveredWetMassKg ?? null,
    moistureContentPercent: delivery?.moistureContentPercent ?? "",
    storageLocationId: delivery?.storageLocationId ?? "",
    driverId: delivery?.driverId ?? undefined,
    vehicleId: delivery?.vehicleId ?? undefined,
    distanceKmOverride: delivery?.distanceKmOverride ?? undefined,
    distanceSource: delivery?.distanceSource ?? null,
    distanceNote: delivery?.distanceNote ?? "",
    tripType: delivery?.tripType ?? orgDefaults.defaultTripType,
  };

  const {
    register,
    control,
    trigger,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(deliveryFormSchema),
    // onTouched so spine markers can flag errors on blur, not only on submit.
    mode: "onTouched",
    defaultValues,
  });

  // CERT chips reflect the saved record (frozen), neutral while creating.
  const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);

  const watchWetMass = useWatch({ control, name: "deliveredWetMassKg" });
  const watchMoisture = useWatch({ control, name: "moistureContentPercent" });
  const watchOrderId = useWatch({ control, name: "orderId" });
  const watchBinId = useWatch({ control, name: "storageLocationId" });
  const watchDate = useWatch({ control, name: "deliveryDate" });
  const distanceKmOverride = useWatch({
    control,
    name: "distanceKmOverride",
  }) as number | null | undefined;
  const draftDistanceSource = useWatch({ control, name: "distanceSource" });

  // Destination's stored distance (+ provenance) — the value the derived
  // transport leg falls back to when this delivery has no override
  // (data-access/transport-legs.ts, map-integration plan decision 3).
  const selectedOrder = orders.find((o) => o.id === watchOrderId);
  const storedDistanceKm = selectedOrder?.destinationDistanceKm ?? null;
  const storedDistanceSource = selectedOrder?.destinationDistanceSource ?? null;

  // The field displays the effective distance: override beats stored. The
  // override is persisted only when the value genuinely differs from the
  // stored distance, so later corrections on the customer location keep
  // propagating to deliveries that never overrode (null-override invariant,
  // schemas/distance-source.ts header).
  const effectiveDistanceKm = distanceKmOverride ?? storedDistanceKm;
  const effectiveDraftDistanceSource: DistanceSourceValue | null =
    draftDistanceSource === "document"
      ? "document"
      : distanceKmOverride != null
        ? (draftDistanceSource ?? "manual")
        : storedDistanceSource;
  const distanceSourceOptions = [
    ...(storedDistanceKm != null && storedDistanceSource === "map_estimate"
      ? [{
          value: "map_estimate",
          label: DISTANCE_SOURCE_LABELS.map_estimate,
        }]
      : []),
    ...(distanceKmOverride != null ||
    storedDistanceSource === "manual" ||
    storedDistanceKm == null
      ? [{ value: "manual", label: DISTANCE_SOURCE_LABELS.manual }]
      : []),
    ...(effectiveDraftDistanceSource === "document"
      ? [{ value: "document", label: DISTANCE_SOURCE_LABELS.document }]
      : []),
  ] as const;

  // Text draft so in-flight typing survives; resync when the effective value
  // changes from outside (order switch, prefill) — adjust-state-during-render.
  const [distanceDraft, setDistanceDraft] = useState(formatDistance(effectiveDistanceKm));
  const [syncedDistanceKm, setSyncedDistanceKm] = useState(effectiveDistanceKm);
  if (effectiveDistanceKm !== syncedDistanceKm) {
    setSyncedDistanceKm(effectiveDistanceKm);
    if (parseDistanceDraft(distanceDraft) !== effectiveDistanceKm) {
      setDistanceDraft(formatDistance(effectiveDistanceKm));
    }
  }

  const handleDistanceChange = (raw: string) => {
    setDistanceDraft(raw);
    const parsed = parseDistanceDraft(raw);
    if (parsed === undefined) return; // unparseable in-flight text — wait
    const isOverride = parsed !== null && parsed !== storedDistanceKm;
    // Keep the render-time resync quiet while editing; a cleared/reverted
    // draft refills from the stored value on blur instead of mid-keystroke.
    setSyncedDistanceKm(isOverride ? parsed : storedDistanceKm);
    setValue("distanceKmOverride", isOverride ? parsed : null, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue("distanceSource", isOverride ? "manual" : null, { shouldDirty: true });
  };

  const handleDistanceBlur = () => {
    if (parseDistanceDraft(distanceDraft) !== effectiveDistanceKm) {
      setDistanceDraft(formatDistance(effectiveDistanceKm));
    }
  };

  const handleDistanceSourceChange = (source: DistanceSourceValue) => {
    if (
      source === "map_estimate" &&
      storedDistanceSource === "map_estimate" &&
      storedDistanceKm != null
    ) {
      setDistanceDraft(formatDistance(storedDistanceKm));
      setSyncedDistanceKm(storedDistanceKm);
      setValue("distanceKmOverride", null, SET_VALUE_OPTS);
      setValue("distanceSource", null, SET_VALUE_OPTS);
      setValue("distanceNote", "", SET_VALUE_OPTS);
      return;
    }

    if (source === "manual" && distanceKmOverride == null) {
      // A matching manual customer-location value remains inherited; only an
      // edited distance becomes a delivery-specific manual override.
      setValue("distanceSource", null, SET_VALUE_OPTS);
      return;
    }
    setValue("distanceSource", source, SET_VALUE_OPTS);
  };

  // Switching orders invalidates a trip-specific override and its note.
  useClearOnDependencyChange(watchOrderId, () => {
    setValue("distanceKmOverride", null, { shouldValidate: true });
    setValue("distanceSource", null);
    setValue("distanceNote", "");
  });

  const matchingBins = useMatchingOutputBins(formFacilityId ?? "", selectedOrder?.formulationId ?? "");
  const wetMass = Number(watchWetMass);
  const moisture = watchMoisture === "" || watchMoisture == null ? NaN : Number(watchMoisture);
  const stockPreview = useOutputStockPreview(!isEditMode && watchBinId && watchDate && wetMass > 0 && Number.isFinite(wetMass) && Number.isFinite(moisture) && moisture >= 0 && moisture < 100 ? {
    storageLocationId: watchBinId, facilityId: formFacilityId ?? "", kind: "delivery",
    physicalDate: String(watchDate), wetMassKg: wetMass, moisturePercent: moisture,
  } : null);
  useClearOnDependencyChange(watchOrderId, () => setValue("storageLocationId", ""));
  const deliveredWetMassError = errors.deliveredWetMassKg?.message ?? stockPreview.data?.blockingMessage ?? undefined;

  const refreshStockPreview = stockPreview.refetch;
  useEffect(() => {
    if (errorMessage && !isEditMode) void refreshStockPreview();
  }, [errorMessage, isEditMode, refreshStockPreview]);

  const defaultSubmitLabel = isEditMode ? "Update Delivery" : "Create Delivery";

  const handleFormSubmit = handleSubmit(async (data) => {
    if (!isEditMode && (!stockPreview.data || stockPreview.isFetching || stockPreview.data.blockingMessage)) return;
    const normalized = data.distanceKmOverride == null ? { ...data, distanceNote: "" } : data;
    try {
      await onSubmit({ ...normalized, status: "delivered", idempotencyKey, basisFingerprint: stockPreview.data?.basisFingerprint } as DeliveryFormData);
    } catch (error) {
      void stockPreview.refetch();
      throw error;
    }
  });

  // All three branches describe the same quantity — the one-way facility ›
  // destination distance the field's own label names — so none of them
  // re-qualifies it. Round-trip doubling is the Trip type field's job.
  const distanceHelperText = !watchOrderId
    ? "Select an order to load the destination's stored distance."
    : storedDistanceKm == null
      ? "This destination has no stored distance. Add one to the customer location, or enter a distance for this delivery."
      : "Facility › destination distance. Edit only when routing differs.";

  return (
    // The wrapper div absorbs the side-sheet Body's direct-child flex-col
    // override so the sticky CTA row keeps its own layout (see sample-form).
    <div className="space-y-20">
      <FormSpine control={control}>
      <form id={formId} onSubmit={handleFormSubmit} className="space-y-20">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      {/* Delivery Information Section */}
      <FormSection
        title="Delivery information"
        icon={<CalendarIcon size={14} weight="bold" />}
        fields={["deliveryDate", "orderId", "storageLocationId"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="deliveryDate" label="Delivery date" error={errors.deliveryDate?.message} required>
            <FormInput
              id="deliveryDate"
              type="date"
              disabled={isSubmitting || isEditMode}
              error={!!errors.deliveryDate}
              {...register("deliveryDate")}
            />
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
          placeholder="Select order..."
          required
          showRemainingDryMass={false}
          disabled={isSubmitting || isEditMode || !formFacilityId}
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
        <FormField id="storageLocationId" label="Actual source bin" required error={errors.storageLocationId?.message}>
          <FormSelect id="storageLocationId" placeholder="Select matching source bin..." disabled={isSubmitting || isEditMode} options={(matchingBins.data ?? []).map(bin => ({ value: bin.id, label: bin.name }))} {...register("storageLocationId")} />
        </FormField>
        {matchingBins.error && <p role="alert">{matchingBins.error.message}</p>}
        {isEditMode && delivery?.storageLocationId && <div className="space-y-8"><p className="body-small">To change stock measurements, open More info and correct the original delivery entry. Saved stock history is preserved.</p><OutputStockHistory storageLocationId={delivery.storageLocationId} facilityId={formFacilityId ?? ""} /></div>}
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
            materialLabel="Biochar product"
            error={deliveredWetMassError}
            hint="Measured wet mass at departure, water included."
            required
            disabled={isSubmitting || isEditMode}
            placeholder="e.g. 1000"
            certifyRequired={isDeliveryCertifyField("deliveredWetMassKg")}
            certifyStatus={certStatus("deliveredWetMassKg")}
            registration={register("deliveredWetMassKg", {
              setValueAs: nullableNumericValue,
            })}
          />
          <MoistureField
            id="moistureContentPercent"
            materialLabel="Biochar product"
            error={errors.moistureContentPercent?.message}
            required
            disabled={isSubmitting || isEditMode}
            placeholder="e.g. 20"
            registration={register("moistureContentPercent")}
          />
        </div>
        {delivery && <DeliveryStockDetails deliveryId={delivery.id} storageLocationId={delivery.storageLocationId} facilityId={delivery.facilityId} wetMassKg={delivery.deliveredWetMassKg} dryMassKg={delivery.massDryKg} />}
        {stockPreview.isFetching && <p role="status">Refreshing stock preview...</p>}
        {stockPreview.error && <p role="alert">{stockPreview.error.message}</p>}
        {stockPreview.data && <OutputStockPreview followFormDetail preview={stockPreview.data} moreInfo={<OutputStockHistory storageLocationId={watchBinId} facilityId={formFacilityId ?? ""} />} />}
      </FormSection>

      {/* Transport Section */}
      <FormSection
        title="Transport"
        icon={<MapPinIcon size={14} weight="bold" />}
        fields={[
          "distanceKmOverride",
          "distanceSource",
          "tripType",
          "distanceNote",
        ]}
      >
        <ActionableFocusTarget
          target="transport-route"
          activeTarget={focusTarget}
          actionLabel="Complete the saved transport route information"
        >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="distanceKmOverride"
            label="One-way distance (per leg, km)"
            error={errors.distanceKmOverride?.message}
            helperText={distanceHelperText}
          >
            <FormInput
              id="distanceKmOverride"
              type="number"
              step="any"
              min={0}
              placeholder="e.g., 85"
              disabled={isSubmitting}
              error={!!errors.distanceKmOverride}
              value={distanceDraft}
              onChange={(event) => handleDistanceChange(event.target.value)}
              onBlur={handleDistanceBlur}
            />
          </FormField>

          <FormField
            id="distanceSource"
            label="Distance source"
            error={errors.distanceSource?.message}
          >
            <FormSelect
              id="distanceSource"
              options={distanceSourceOptions}
              placeholder="Select source"
              disabled={isSubmitting || effectiveDistanceKm == null}
              error={!!errors.distanceSource}
              {...register("distanceSource")}
              value={effectiveDraftDistanceSource ?? ""}
              onChange={(event) =>
                handleDistanceSourceChange(
                  event.target.value as DistanceSourceValue,
                )
              }
            />
          </FormField>

          <FormField
            id="tripType"
            label="Trip type"
            error={errors.tripType?.message}
            helperText="Return doubles the distance (vehicle returns empty). Choose One-way only with an evidenced onward destination."
          >
            <FormSelect
              id="tripType"
              options={TRIP_TYPE_OPTIONS}
              disabled={isSubmitting}
              error={!!errors.tripType}
              {...register("tripType")}
            />
          </FormField>
        </div>

        {distanceKmOverride != null && (
          <FormField
            id="distanceNote"
            label="Distance note"
            error={errors.distanceNote?.message}
            helperText="Explain why this trip used a different route."
          >
            <FormTextarea
              id="distanceNote"
              placeholder="e.g., detour via the coastal road due to bridge closure"
              disabled={isSubmitting}
              error={!!errors.distanceNote}
              {...register("distanceNote")}
            />
          </FormField>
        )}
        </ActionableFocusTarget>
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
        submitDisabled={!isEditMode && (!stockPreview.data || stockPreview.isFetching || !!stockPreview.data.blockingMessage)}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </div>
  );
}
