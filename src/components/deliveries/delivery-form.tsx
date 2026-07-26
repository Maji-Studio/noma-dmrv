/**
 * DeliveryForm component
 * Reusable delivery form with React Hook Form integration
 * Includes validation: massDryKg <= deliveredWetMassKg
 */
"use client";

import { useEffect, useId, useState } from "react";
import { numericValue } from "@/lib/form-utils";
import { toDateInputValue } from "@/lib/date-utils";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarIcon, ScalesIcon, MapPinIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, FormTextarea, FormEntitySelect, FormActions, FormSection, FormSpine, MassMoistureFields, makeCertFieldStatus } from "@/components/forms";
import { formatDistance, parseDistanceDraft } from "@/components/forms/distance-calc-field";
import { FormSelect } from "@/components/forms/form-select";
import { deliveryFormSchema, deliveryStatuses, type DeliveryFormData, type DeliveryStatus } from "@/schemas/deliveries";
import { DISTANCE_SOURCE_LABELS } from "@/schemas/distance-source";
import { DEFAULT_TRIP_TYPE, TRIP_TYPE_OPTIONS } from "@/schemas/trip-type";
import type { Delivery } from "@/db/schema";
import { useOrdersForSelect } from "@/hooks/use-orders";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useClearOnDependencyChange } from "@/hooks/use-clear-on-dependency-change";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { DeliveryEvidenceSection } from "./delivery-trailing-sections";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";

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

  // The order picker fetches its own options (FormEntitySelect); this query
  // only backs the stored-distance prefill for the selected order below.
  const { data: ordersData } = useOrdersForSelect(contextFacilityId ?? undefined, {
    enabled: !!contextFacilityId,
  });
  const orders = ordersData ?? [];
  const defaultStatus: DeliveryStatus = isDeliveryStatus(delivery?.status) ? delivery.status : "upcoming";

  const defaultValues = {
    orderId: delivery?.orderId ?? "",
    deliveryDate: toDateInputValue(delivery?.deliveryDate),
    status: defaultStatus,
    deliveredWetMassKg: delivery?.deliveredWetMassKg ?? undefined,
    massDryKg: delivery?.massDryKg ?? undefined,
    moistureContentPercent: delivery?.moistureContentPercent ?? undefined,
    biocharProductId: delivery?.biocharProductId ?? undefined,
    driverId: delivery?.driverId ?? undefined,
    vehicleId: delivery?.vehicleId ?? undefined,
    distanceKmOverride: delivery?.distanceKmOverride ?? undefined,
    distanceSource: delivery?.distanceSource ?? null,
    distanceNote: delivery?.distanceNote ?? "",
    tripType: delivery?.tripType ?? DEFAULT_TRIP_TYPE,
  };

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
    defaultValues,
  });

  // CERT chips reflect the saved record (frozen), neutral while creating.
  const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);

  const watchWetMass = watch("deliveredWetMassKg");
  const watchMoisture = watch("moistureContentPercent");
  const watchOrderId = watch("orderId");
  const distanceKmOverride = watch("distanceKmOverride") as number | null | undefined;
  const draftDistanceSource = watch("distanceSource");

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
  const savedEffectiveDistanceSource = delivery
    ? delivery.distanceSource === "document"
      ? "document"
      : delivery.distanceKmOverride != null
      ? (delivery.distanceSource ?? "manual")
      : storedDistanceSource
    : null;
  const savedProvenanceLoaded = delivery
    ? delivery.distanceSource === "document" ||
      delivery.distanceKmOverride != null ||
      selectedOrder !== undefined
    : undefined;

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
    ? "Select an order to load the destination's stored one-way distance."
    : storedDistanceKm == null
      ? "No stored distance for this destination — add it on the customer location. A one-off manual one-way distance is still possible. Return trips are doubled at emissions time."
      : "One-way facility › destination distance, prefilled from the customer location; return trips are doubled at emissions time. Edit only when routing differs.";

  return (
    // The wrapper div absorbs the side-sheet Body's direct-child flex-col
    // override so the sticky CTA row keeps its own layout (see sample-form).
    <div className="space-y-20">
      <FormSpine control={control}>
      <form id={formId} onSubmit={handleFormSubmit} className="space-y-20">
      {/* Delivery Information Section */}
      <FormSection
        title="Delivery Information"
        icon={<CalendarIcon size={14} weight="bold" />}
        fields={["deliveryDate", "status", "orderId"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="deliveryDate" label="Delivery Date" error={errors.deliveryDate?.message} required>
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
          emptyHint={{
            message:
              "No orders yet — a delivery fulfils an order, so record the customer order first.",
            href: contextFacilityId
              ? `/orders?facility=${encodeURIComponent(contextFacilityId)}`
              : "/orders",
            linkLabel: "Open orders",
          }}
        />
      </FormSection>

      {/* Mass & Moisture Section */}
      <FormSection
        title="Mass and moisture"
        icon={<ScalesIcon size={14} weight="bold" />}
        fields={["deliveredWetMassKg", "moistureContentPercent", "massDryKg"]}
      >
        <MassMoistureFields
          wetMassKg={watchWetMass}
          moisturePercent={watchMoisture}
          wet={{
            id: "deliveredWetMassKg",
            error: errors.deliveredWetMassKg?.message,
            hint: "As-received weight of the delivery, water included.",
            required: true,
            disabled: isSubmitting,
            placeholder: "e.g. 1000",
            certifyRequired: isDeliveryCertifyField("deliveredWetMassKg"),
            certifyStatus: certStatus("deliveredWetMassKg"),
            registration: register("deliveredWetMassKg", { setValueAs: numericValue }),
          }}
          moisture={{
            id: "moistureContentPercent",
            error: errors.moistureContentPercent?.message,
            required: true,
            disabled: isSubmitting,
            placeholder: "e.g. 20",
            registration: register("moistureContentPercent", { setValueAs: numericValue }),
          }}
        />

        {/* The split above is display-only; massDryKg is recomputed server-side
            and synced through the hidden field below for submission. */}
        {errors.massDryKg?.message && (
          <p className="body-small text-[var(--color-status-error)]">{errors.massDryKg.message}</p>
        )}
        <input type="hidden" {...register("massDryKg", { setValueAs: numericValue })} />
      </FormSection>

      {/* Transport Section */}
      <FormSection
        title="Transport"
        icon={<MapPinIcon size={14} weight="bold" />}
        fields={["distanceKmOverride", "tripType", "distanceNote"]}
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
        distanceSource={savedEffectiveDistanceSource}
        provenanceLoaded={savedProvenanceLoaded}
        focusTarget={focusTarget}
        draftDistanceSource={
          draftDistanceSource === "document"
            ? "document"
            : distanceKmOverride != null
              ? (draftDistanceSource ?? "manual")
              : storedDistanceSource
        }
        onSelectDocumentProvenance={() =>
          setValue("distanceSource", "document", {
            shouldDirty: true,
            shouldTouch: true,
            shouldValidate: true,
          })
        }
      />
      </FormSpine>

      <FormActions
        formId={formId}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </div>
  );
}
