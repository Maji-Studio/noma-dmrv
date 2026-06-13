/**
 * DeliveryForm component
 * Reusable delivery form with React Hook Form integration
 * Includes validation: massDryKg <= deliveredWetMassKg
 */
"use client";

import { useEffect, useState } from "react";
import { numericValue } from "@/lib/form-utils";
import { formatLocalDate } from "@/lib/date-utils";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Calendar, Scales, Truck, MapPin } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, FormTextarea, FormEntitySelect, FormActions, FormSection, FormSpine, TruckWeighingSection } from "@/components/forms";
import { formatDistance, parseDistanceDraft } from "@/components/forms/distance-calc-field";
import { FormSelect } from "@/components/forms/form-select";
import { deliveryFormSchema, deliveryStatuses, type DeliveryFormData, type DeliveryStatus } from "@/schemas/deliveries";
import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";
import type { Delivery } from "@/db/schema";
import { useOrdersForSelect } from "@/hooks/use-orders";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useClearOnDependencyChange } from "@/hooks/use-clear-on-dependency-change";

// ============================================
// Constants for select options
// ============================================

const statusOptions: readonly { value: string; label: string }[] = deliveryStatuses.map((status) => ({
  value: status,
  label: formatStatus(status),
}));

const isDeliveryCertifyField = (field: string) =>
  isCertifyFormField("delivery", field);

// ============================================
// Formatting helpers
// ============================================

function formatStatus(status: DeliveryStatus): string {
  const labels: Record<DeliveryStatus, string> = {
    upcoming: "Upcoming",
    delivered: "Delivered",
  };
  return labels[status];
}

function isDeliveryStatus(value: string | null | undefined): value is DeliveryStatus {
  return !!value && deliveryStatuses.includes(value as DeliveryStatus);
}

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
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function DeliveryForm({ delivery, onSubmit, onCancel, isSubmitting = false, submitLabel }: DeliveryFormProps) {
  const isEditMode = !!delivery;
  const { facilityId: contextFacilityId } = useFacilityContext();

  // The order picker fetches its own options (FormEntitySelect); this query
  // only backs the stored-distance prefill for the selected order below.
  const { data: ordersData } = useOrdersForSelect(contextFacilityId ?? undefined, {
    enabled: !!contextFacilityId,
  });
  const orders = ordersData ?? [];
  const defaultStatus: DeliveryStatus = isDeliveryStatus(delivery?.status) ? delivery.status : "upcoming";

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(deliveryFormSchema),
    // onTouched so spine markers can flag errors on blur, not only on submit.
    mode: "onTouched",
    defaultValues: {
      orderId: delivery?.orderId ?? "",
      deliveryDate: delivery?.deliveryDate ?? formatLocalDate(new Date()),
      status: defaultStatus,
      deliveredWetMassKg: delivery?.deliveredWetMassKg ?? undefined,
      massDryKg: delivery?.massDryKg ?? undefined,
      moistureContentPercent: delivery?.moistureContentPercent ?? undefined,
      truckMassOnArrivalKg: delivery?.truckMassOnArrivalKg ?? undefined,
      truckMassOnDepartureKg: delivery?.truckMassOnDepartureKg ?? undefined,
      biocharProductId: delivery?.biocharProductId ?? undefined,
      driverId: delivery?.driverId ?? undefined,
      vehicleId: delivery?.vehicleId ?? undefined,
      distanceKmOverride: delivery?.distanceKmOverride ?? undefined,
      distanceSource: delivery?.distanceSource ?? null,
      distanceNote: delivery?.distanceNote ?? "",
    },
  });

  const watchWetMass = watch("deliveredWetMassKg");
  const watchMoisture = watch("moistureContentPercent");
  const watchArrivalMass = watch("truckMassOnArrivalKg");
  const watchDepartureMass = watch("truckMassOnDepartureKg");
  const watchOrderId = watch("orderId");
  const distanceKmOverride = watch("distanceKmOverride") as number | null | undefined;

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

  // Switching orders invalidates a trip-specific override and its note.
  useClearOnDependencyChange(watchOrderId, () => {
    setValue("distanceKmOverride", null, { shouldValidate: true });
    setValue("distanceSource", null);
    setValue("distanceNote", "");
  });

  // Auto-calculate dry mass from wet mass and moisture using shared utility
  const calculatedDryMass =
    typeof watchWetMass === "number" &&
    typeof watchMoisture === "number" &&
    watchWetMass >= 0 &&
    watchMoisture >= 0 &&
    watchMoisture <= 100
      ? deriveMassDryKg(watchWetMass, watchMoisture)
      : null;

  // Sync calculated dry mass into the form (clear when inputs become invalid)
  useEffect(() => {
    if (calculatedDryMass !== null) {
      setValue("massDryKg", calculatedDryMass);
    } else {
      setValue("massDryKg", undefined as unknown as number);
    }
  }, [calculatedDryMass, setValue]);

  const defaultSubmitLabel = isEditMode ? "Update Delivery" : "Create Delivery";

  const handleFormSubmit = handleSubmit((data) => {
    // A distance note only explains an override — never persist one without.
    const normalized =
      data.distanceKmOverride == null ? { ...data, distanceNote: "" } : data;
    return onSubmit(normalized as DeliveryFormData);
  });

  const distanceHelperText = !watchOrderId
    ? "Select an order to load the destination's stored distance."
    : storedDistanceKm == null
      ? "No stored distance for this destination — add it on the customer location. A one-off manual distance is still possible."
      : "Prefilled from the destination's stored distance. Edit only when this trip's routing differs.";

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      <FormSpine control={control}>
      {/* Delivery Information Section */}
      <FormSection
        title="Delivery Information"
        icon={<Calendar size={14} weight="bold" />}
        fields={["deliveryDate", "status", "orderId"]}
        required={["deliveryDate", "orderId"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="deliveryDate" label="Delivery Date" error={errors.deliveryDate?.message}>
            <FormInput
              id="deliveryDate"
              type="date"
              disabled={isSubmitting}
              error={!!errors.deliveryDate}
              {...register("deliveryDate")}
            />
          </FormField>

          <FormField id="status" label="Status" error={errors.status?.message}>
            <FormSelect
              id="status"
              disabled={isSubmitting}
              error={!!errors.status}
              options={statusOptions}
              {...register("status")}
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
          disabled={isSubmitting || !contextFacilityId}
          filterBy={contextFacilityId ? { facilityId: contextFacilityId } : undefined}
        />
      </FormSection>

      {/* Mass & Moisture Section */}
      <FormSection
        title="Mass & Moisture"
        icon={<Scales size={14} weight="bold" />}
        fields={["deliveredWetMassKg", "moistureContentPercent", "massDryKg"]}
        required={["deliveredWetMassKg", "moistureContentPercent"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="deliveredWetMassKg"
            label="Wet Mass (kg)"
            error={errors.deliveredWetMassKg?.message}
            helperText="As-received weight. Truck weighing can prefill it."
            required
            certifyRequired={isDeliveryCertifyField("deliveredWetMassKg")}
          >
            <FormInput
              id="deliveredWetMassKg"
              type="number"
              step="0.01"
              placeholder="e.g., 1000"
              disabled={isSubmitting}
              error={!!errors.deliveredWetMassKg}
              {...register("deliveredWetMassKg", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="moistureContentPercent"
            label="Moisture (%)"
            error={errors.moistureContentPercent?.message}
            helperText="0–100%"
            required
          >
            <FormInput
              id="moistureContentPercent"
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="e.g., 20"
              disabled={isSubmitting}
              error={!!errors.moistureContentPercent}
              {...register("moistureContentPercent", {
                setValueAs: numericValue,
              })}
            />
          </FormField>
        </div>

        {/* Dry mass preview (display only — auto-calculated) */}
        <div className="flex items-center gap-12 rounded-sm border border-[var(--color-border-tertiary)] bg-[var(--color-bg-tertiary)] px-16 py-12">
          <span className="body-small text-[var(--color-text-tertiary)]">Dry Mass (kg)</span>
          <span className="body-medium font-medium text-[var(--color-text-primary)]">
            {calculatedDryMass !== null ? `${calculatedDryMass.toFixed(2)} kg` : "—"}
          </span>
          {calculatedDryMass !== null && (
            <span className="body-small text-[var(--color-text-quaternary)]">
              = {Number(watchWetMass ?? 0).toFixed(0)} × (1 − {Number(watchMoisture ?? 0)}%)
            </span>
          )}
        </div>
        {errors.massDryKg?.message && (
          <p className="body-small text-[var(--color-status-error)]">{errors.massDryKg.message}</p>
        )}
        <input type="hidden" {...register("massDryKg", { setValueAs: numericValue })} />
      </FormSection>

      <FormSection
        title="Truck Weighing"
        icon={<Truck size={14} weight="bold" />}
        hint="Arrival minus departure gives the unloaded wet mass used as weighbridge evidence."
        fields={["truckMassOnArrivalKg", "truckMassOnDepartureKg"]}
        required={["truckMassOnArrivalKg", "truckMassOnDepartureKg"]}
      >
        <TruckWeighingSection
          bare
          arrivalMassKg={watchArrivalMass}
          departureMassKg={watchDepartureMass}
          wetMassKg={watchWetMass}
          wetMassLabel="Entered wet mass"
          onSuggestWetMass={(wetMassKg) =>
            setValue("deliveredWetMassKg", wetMassKg, { shouldValidate: true })
          }
          arrivalRegister={register("truckMassOnArrivalKg", {
            setValueAs: numericValue,
          })}
          departureRegister={register("truckMassOnDepartureKg", {
            setValueAs: numericValue,
          })}
          arrivalError={errors.truckMassOnArrivalKg?.message}
          departureError={errors.truckMassOnDepartureKg?.message}
          arrivalCertifyRequired={isDeliveryCertifyField("truckMassOnArrivalKg")}
          departureCertifyRequired={isDeliveryCertifyField("truckMassOnDepartureKg")}
          isSubmitting={isSubmitting}
        />
      </FormSection>

      {/* Transport Section */}
      <FormSection
        title="Transport"
        icon={<MapPin size={14} weight="bold" />}
        fields={["distanceKmOverride", "distanceNote"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="distanceKmOverride"
            label="Distance (km)"
            error={errors.distanceKmOverride?.message}
            helperText={distanceHelperText}
          >
            <div>
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
              {distanceKmOverride != null ? (
                <p
                  className="body-caption uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] mt-6"
                  data-testid="distanceKmOverride-distance-source"
                >
                  Source: {DISTANCE_SOURCE_LABELS.manual} — overrides the stored distance
                </p>
              ) : storedDistanceKm != null ? (
                <p
                  className="body-caption uppercase tracking-[0.08em] text-[var(--color-text-tertiary)] mt-6"
                  data-testid="distanceKmOverride-distance-source"
                >
                  From customer location
                  {storedDistanceSource ? ` — ${DISTANCE_SOURCE_LABELS[storedDistanceSource]}` : ""}
                </p>
              ) : null}
            </div>
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
      </FormSection>
      </FormSpine>

      <FormActions
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
