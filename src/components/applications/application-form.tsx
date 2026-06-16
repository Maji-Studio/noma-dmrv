/**
 * ApplicationForm component
 * Reusable application form with React Hook Form integration
 *
 * Form sections:
 * 1. Application Details — applicationDate, delivery, biocharAppliedTons + auto-calculated dry mass card
 * 2. Field Details — fieldSizeHa, fieldIdentifier, cropType, GPS coordinates
 * 3. Soil Temperature — soilTemperatureSource (enum toggle), soilTemperatureC
 */
"use client";

import { numericValue } from "@/lib/form-utils";
import { formatLocalDate } from "@/lib/date-utils";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Package, MapPin, Camera, Thermometer } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, FormSelect, FormSection, FormSpine, PositionPicker, FormActions, makeCertFieldStatus } from "@/components/forms";
import {
  applicationFormSchema,
  applicationEvidenceMethods,
  applicationMethods,
  soilTemperatureSources,
  formatApplicationEvidenceMethod,
  formatApplicationMethod,
  formatSoilTemperatureSource,
  type ApplicationFormData,
  type ApplicationEvidenceMethod,
  type ApplicationMethod,
  type SoilTemperatureSource,
} from "@/schemas/applications";
import type { Application } from "@/db/schema/application";
import { ApplicationEvidencePanel } from "./application-evidence-panel";
import {
  applicationKgToTons,
  applicationTonsToKg,
  calculateDryMass,
  formatApplicationDeliveryHelperText,
  formatApplicationDeliveryOptionLabel,
  formatKg,
  resolveApplicationPositionDefault,
  resolveApplicationSoilTemperatureDefault,
  type ApplicationDeliveryOption,
} from "./mass-utils";

// ============================================
// Constants for select options
// ============================================

const isApplicationCertifyField = (field: string) =>
  isCertifyFormField("application", field);

const applicationMethodOptions: readonly { value: string; label: string }[] = applicationMethods.map((method) => ({
  value: method,
  label: formatApplicationMethod(method as ApplicationMethod),
}));

const soilTemperatureSourceOptions: readonly { value: string; label: string }[] = soilTemperatureSources.map(
  (source) => ({
    value: source,
    label: formatSoilTemperatureSource(source as SoilTemperatureSource),
  }),
);

const evidenceMethodDescriptions: Record<ApplicationEvidenceMethod, string> = {
  visual: "Geotagged photos for all three stages — stockpile, spreading, incorporation",
  boundary: "GIS boundary map + dated logbook quantities (weighbridge, inventory, or affidavit)",
};

// ============================================
// Dry Mass Calculation Card
// ============================================

function DryMassCard({
  appliedKg,
  moisturePercent,
}: {
  appliedKg: number | null | undefined;
  moisturePercent: number | null | undefined;
}) {
  const dryKg = calculateDryMass(appliedKg, moisturePercent);
  const hasMoisture = moisturePercent != null;
  const hasApplied = appliedKg != null && appliedKg > 0;
  const moistureFraction = moisturePercent != null ? moisturePercent / 100 : null;
  const moistureKg =
    appliedKg != null && moistureFraction != null
      ? appliedKg * moistureFraction
      : null;

  if (!hasMoisture && !hasApplied) return null;

  return (
    <div className="col-span-full mt-8">
      {!hasMoisture ? (
        <div className="flex items-start gap-10 py-12 px-16 border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-sunken)]">
          <span className="body-small text-[var(--color-text-tertiary)] leading-relaxed">
            No moisture content on delivery — enter dry mass manually or update the delivery record.
          </span>
        </div>
      ) : !hasApplied ? (
        <div className="flex items-start gap-10 py-12 px-16 border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-sunken)]">
          <span className="body-small text-[var(--color-text-tertiary)] leading-relaxed">
            Enter wet mass applied to calculate dry mass.
          </span>
        </div>
      ) : (
        <div className="bg-[var(--color-background-sunken)] border border-[var(--color-border-tertiary)]">
          {/* Header */}
          <div className="px-16 py-8 border-b border-[var(--color-border-tertiary)]">
            <span className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
              Dry Mass Calculation
            </span>
          </div>

          {/* Visual breakdown */}
          <div className="px-16 py-12">
            <div className="flex items-center gap-8">
              {/* Wet mass */}
              <div className="flex flex-col items-center gap-2 min-w-0">
                <span className="font-mono text-[var(--text-base)] font-[var(--font-weight-bold)] text-[var(--color-text-primary)]">
                  {formatKg(appliedKg)}
                </span>
                <span className="body-caption text-[var(--color-text-quaternary)]">
                  wet mass
                </span>
              </div>

              {/* Minus sign */}
              <span className="font-mono text-[var(--text-base)] text-[var(--color-text-tertiary)] shrink-0 pb-16">
                &minus;
              </span>

              {/* Moisture removed */}
              <div className="flex flex-col items-center gap-2 min-w-0">
                <span className="font-mono text-[var(--text-base)] text-[var(--color-text-tertiary)]">
                  {formatKg(moistureKg)}
                </span>
                <span className="body-caption text-[var(--color-text-quaternary)]">
                  moisture ({moisturePercent?.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)
                </span>
              </div>

              {/* Equals sign */}
              <span className="font-mono text-[var(--text-base)] text-[var(--color-text-tertiary)] shrink-0 pb-16">
                =
              </span>

              {/* Dry mass result */}
              <div className="flex flex-col items-center gap-2 min-w-0 px-12 py-4 bg-[var(--clr-purple-10)] border-l-2 border-[var(--clr-purple)]">
                <span className="font-mono text-[var(--text-lg)] font-bold text-[var(--color-text-primary)]" aria-live="polite" aria-atomic="true">
                  {formatKg(dryKg)}
                </span>
                <span className="body-caption font-medium text-[var(--clr-purple)]">
                  dry mass
                </span>
              </div>
            </div>
          </div>

          {/* Source note */}
          <div className="px-16 py-6 border-t border-[var(--color-border-tertiary)]">
            <span className="body-caption text-[var(--color-text-quaternary)]">
              Moisture % from delivery record
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Component
// ============================================

interface ApplicationFormProps {
  /** Existing application data for editing (undefined for create mode) */
  application?: Application;
  /** Available deliveries for selection */
  deliveries?: ApplicationDeliveryOption[];
  /** Form submission handler */
  onSubmit: (data: ApplicationFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function ApplicationForm({
  application,
  deliveries = [],
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: ApplicationFormProps) {
  const isEditMode = !!application;

  const defaultValues = {
    applicationDate: application?.applicationDate
      ? formatLocalDate(new Date(application.applicationDate))
      : formatLocalDate(new Date()),
    deliveryId: application?.deliveryId ?? "",
    biocharAppliedTons: applicationTonsToKg(application?.biocharAppliedTons) ?? undefined,
    biocharAppliedDryTons: applicationTonsToKg(application?.biocharAppliedDryTons) ?? undefined,
    fieldSizeHa: application?.fieldSizeHa ?? undefined,
    fieldIdentifier: application?.fieldIdentifier ?? "",
    cropType: application?.cropType ?? "",
    gpsLatitude: application?.gpsLatitude ?? undefined,
    gpsLongitude: application?.gpsLongitude ?? undefined,
    applicationMethodType: (application?.applicationMethodType as ApplicationMethod) ?? undefined,
    evidenceMethod: (application?.evidenceMethod as ApplicationEvidenceMethod | undefined) ?? "visual",
    gisBoundaryReference: application?.gisBoundaryReference ?? "",
    soilTemperatureSource: (application?.soilTemperatureSource as SoilTemperatureSource) ?? undefined,
    soilTemperatureC: application?.soilTemperatureC ?? undefined,
  };

  const {
    register,
    handleSubmit,
    control,
    setError,
    setValue,
    getFieldState,
    formState: { errors },
  } = useForm<z.input<typeof applicationFormSchema>, unknown, ApplicationFormData>({
    resolver: zodResolver(applicationFormSchema),
    // onTouched so spine markers can flag errors on blur, not only on submit.
    mode: "onTouched",
    defaultValues,
  });

  // CERT chips reflect the saved record (frozen), neutral while creating.
  const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);

  const defaultSubmitLabel = isEditMode ? "Update Application" : "Create Application";
  const selectedDeliveryId = useWatch({ control, name: "deliveryId" });
  const watchedAppliedKg = useWatch({ control, name: "biocharAppliedTons" });
  const evidenceMethod = useWatch({ control, name: "evidenceMethod" }) as ApplicationEvidenceMethod;
  const gpsLatitude = useWatch({ control, name: "gpsLatitude" }) as number | null | undefined;
  const gpsLongitude = useWatch({ control, name: "gpsLongitude" }) as number | null | undefined;

  const deliveryOptions = deliveries.map((d) => ({
    value: d.id,
    label: formatApplicationDeliveryOptionLabel(d),
  }));
  const selectedDelivery = deliveries.find((delivery) => delivery.id === selectedDeliveryId);

  // Prefill soil temperature from the delivery's customer-location /
  // facility default, but only while the operator hasn't touched the
  // fields (prefills don't set them dirty). While untouched, the values
  // always mirror the selected delivery — including clearing a stale
  // prefill when the new delivery has no default.
  useEffect(() => {
    if (isEditMode || !selectedDelivery) return;

    const temperatureState = getFieldState("soilTemperatureC");
    const sourceState = getFieldState("soilTemperatureSource");
    if (temperatureState.isDirty || sourceState.isDirty) {
      return;
    }

    const defaultValue = resolveApplicationSoilTemperatureDefault({
      delivery: selectedDelivery,
    });

    setValue("soilTemperatureSource", defaultValue?.soilTemperatureSource, {
      shouldDirty: false,
      shouldValidate: true,
    });
    setValue("soilTemperatureC", defaultValue?.soilTemperatureC, {
      shouldDirty: false,
      shouldValidate: true,
    });
  }, [getFieldState, isEditMode, selectedDelivery, setValue]);

  // Prefill the field position from the delivery's destination customer
  // location, but only while the operator hasn't touched it (pin drag and
  // address search set the fields dirty; prefills don't). While untouched,
  // the position always mirrors the selected delivery — including clearing
  // a stale prefill when the new destination has no GPS.
  useEffect(() => {
    if (isEditMode || !selectedDelivery) return;
    if (
      getFieldState("gpsLatitude").isDirty ||
      getFieldState("gpsLongitude").isDirty
    ) {
      return;
    }

    const positionDefault = resolveApplicationPositionDefault({
      delivery: selectedDelivery,
    });
    setValue("gpsLatitude", positionDefault?.gpsLatitude, {
      shouldDirty: false,
      shouldValidate: true,
    });
    setValue("gpsLongitude", positionDefault?.gpsLongitude, {
      shouldDirty: false,
      shouldValidate: true,
    });
  }, [getFieldState, isEditMode, selectedDelivery, setValue]);

  const moisturePercent = selectedDelivery?.moistureContentPercent ?? null;
  const appliedKgNum = typeof watchedAppliedKg === "string" ? parseFloat(watchedAppliedKg) : watchedAppliedKg;
  const appliedKgValid = appliedKgNum != null && !isNaN(appliedKgNum) && appliedKgNum > 0 ? appliedKgNum : null;

  // Remaining capacity for the selected delivery
  const deliveryCapacityKg = selectedDelivery?.deliveredWetMassKg ?? null;
  const alreadyApplied = selectedDelivery?.alreadyAppliedWetKg ?? 0;
  const isSameDelivery = isEditMode && application?.deliveryId === selectedDeliveryId;
  const currentApplicationKg = isSameDelivery ? (applicationTonsToKg(application?.biocharAppliedTons) ?? 0) : 0;
  const availableKg = deliveryCapacityKg !== null ? deliveryCapacityKg - alreadyApplied + currentApplicationKg : null;

  const handleFormSubmit = handleSubmit(async (data) => {
    if (availableKg !== null && data.biocharAppliedTons > availableKg) {
      setError("biocharAppliedTons", {
        type: "manual",
        message: `Cannot exceed available: ${formatKg(availableKg)} remaining from this delivery`,
      });
      return;
    }

    const biocharAppliedTons = applicationKgToTons(data.biocharAppliedTons);

    // Auto-calculate dry tons from moisture, or fall back to manual entry
    const calculatedDryKg = calculateDryMass(data.biocharAppliedTons, moisturePercent);
    const dryKgValue = calculatedDryKg ?? data.biocharAppliedDryTons;
    const biocharAppliedDryTons = applicationKgToTons(dryKgValue);

    if (biocharAppliedTons == null) {
      throw new Error("Biochar applied mass is required");
    }

    if (biocharAppliedDryTons == null) {
      setError("biocharAppliedDryTons", {
        type: "manual",
        message: "Dry mass is required when delivery has no moisture data",
      });
      return;
    }

    await onSubmit({
      ...data,
      biocharAppliedTons,
      biocharAppliedDryTons,
      gisBoundaryReference:
        data.evidenceMethod === "boundary" ? data.gisBoundaryReference : "",
    });
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      <FormSpine control={control}>
      {/* === Section 1: Application Details === */}
      <FormSection
        title="Application Details"
        icon={<Package size={14} weight="bold" />}
        fields={["applicationDate", "deliveryId", "biocharAppliedTons", "biocharAppliedDryTons"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="applicationDate" label="Application Date" error={errors.applicationDate?.message} required>
            <FormInput
              id="applicationDate"
              type="date"
              disabled={isSubmitting}
              error={!!errors.applicationDate}
              {...register("applicationDate")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 gap-y-20">
          <FormField
            id="deliveryId"
            label="Delivery"
            error={errors.deliveryId?.message}
            required
            helperText={
              selectedDelivery
                ? formatApplicationDeliveryHelperText(selectedDelivery)
                : "Choose a delivery by order, formulation, and kg."
            }
          >
            <FormSelect
              id="deliveryId"
              placeholder="Select delivery..."
              disabled={isSubmitting}
              error={!!errors.deliveryId}
              options={deliveryOptions}
              {...register("deliveryId")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="biocharAppliedTons"
            label="Biochar Applied, Wet (kg)"
            error={errors.biocharAppliedTons?.message}
            required
            certifyRequired={isApplicationCertifyField("biocharAppliedTons")}
            certifyStatus={certStatus("biocharAppliedTons")}
            helperText={
              availableKg !== null
                ? `${formatKg(availableKg)} available from this delivery`
                : "As-received mass at delivery, before moisture adjustment"
            }
          >
            <FormInput
              id="biocharAppliedTons"
              type="number"
              step="any"
              placeholder="e.g., 5000"
              disabled={isSubmitting}
              error={!!errors.biocharAppliedTons}
              {...register("biocharAppliedTons", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          {/* Show manual dry input only when delivery has no moisture data */}
          {moisturePercent == null && selectedDelivery && (
            <FormField
              id="biocharAppliedDryTons"
              label="Biochar Applied Dry (kg)"
              error={errors.biocharAppliedDryTons?.message}
              helperText="No moisture % on delivery — enter dry mass manually"
              certifyRequired={isApplicationCertifyField("biocharAppliedDryTons")}
              certifyStatus={certStatus("biocharAppliedDryTons")}
            >
              <FormInput
                id="biocharAppliedDryTons"
                type="number"
                step="any"
                placeholder="e.g., 4500"
                disabled={isSubmitting}
                error={!!errors.biocharAppliedDryTons}
                {...register("biocharAppliedDryTons", {
                  setValueAs: numericValue,
                })}
              />
            </FormField>
          )}

          <DryMassCard
            appliedKg={appliedKgValid}
            moisturePercent={moisturePercent}
          />
        </div>
      </FormSection>

      {/* === Section 2: Field Details === */}
      <FormSection
        title="Field Details"
        icon={<MapPin size={14} weight="bold" />}
        fields={["fieldSizeHa", "fieldIdentifier", "cropType", "applicationMethodType", "gpsLatitude", "gpsLongitude"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="fieldSizeHa" label="Field Size (Ha)" error={errors.fieldSizeHa?.message}>
            <FormInput
              id="fieldSizeHa"
              type="number"
              step="any"
              placeholder="e.g., 2.5"
              disabled={isSubmitting}
              error={!!errors.fieldSizeHa}
              {...register("fieldSizeHa", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="fieldIdentifier"
            label="Field Identifier"
            error={errors.fieldIdentifier?.message}
            helperText="Field name or parcel ID"
          >
            <FormInput
              id="fieldIdentifier"
              type="text"
              placeholder="e.g., Demonstration Plot A"
              disabled={isSubmitting}
              error={!!errors.fieldIdentifier}
              {...register("fieldIdentifier")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="cropType" label="Crop Type" error={errors.cropType?.message}>
            <FormInput
              id="cropType"
              type="text"
              placeholder="e.g., Coffee"
              disabled={isSubmitting}
              error={!!errors.cropType}
              {...register("cropType")}
            />
          </FormField>

          <FormField
            id="applicationMethodType"
            label="Application Method"
            error={errors.applicationMethodType?.message}
          >
            <FormSelect
              id="applicationMethodType"
              placeholder="Select method..."
              disabled={isSubmitting}
              error={!!errors.applicationMethodType}
              options={applicationMethodOptions}
              {...register("applicationMethodType")}
            />
          </FormField>
        </div>

        <PositionPicker
          idPrefix="gps"
          label="Field position"
          accent="pink"
          latitude={gpsLatitude ?? null}
          longitude={gpsLongitude ?? null}
          onPositionChange={({ lat, lng }) => {
            setValue("gpsLatitude", lat, { shouldDirty: true, shouldValidate: true });
            setValue("gpsLongitude", lng, { shouldDirty: true, shouldValidate: true });
          }}
          latitudeError={errors.gpsLatitude?.message}
          longitudeError={errors.gpsLongitude?.message}
          disabled={isSubmitting}
        />

      </FormSection>

      {/* === Section 3: Evidence === */}
      <FormSection
        title="Evidence Method"
        icon={<Camera size={14} weight="bold" />}
        hint="Isometric requires one of two evidence paths per application: geotagged stage photos, or a GIS boundary map with logbook quantities (Biochar Storage in Soil module §8.5)."
        fields={["evidenceMethod", "gisBoundaryReference"]}
      >
        <div
          className="grid grid-cols-1 gap-8 md:grid-cols-2"
          role="radiogroup"
          aria-label="Evidence method"
        >
          {applicationEvidenceMethods.map((method) => (
            <label
              key={method}
              className={[
                "flex min-h-44 cursor-pointer flex-col gap-4 border px-14 py-12 transition-colors duration-300",
                evidenceMethod === method
                  ? "border-[var(--color-interaction)] bg-[var(--color-background-interaction-light)]"
                  : "border-[var(--color-border-tertiary)] bg-[var(--color-background-white)]",
              ].join(" ")}
            >
              <span className="flex items-center gap-8">
                <input
                  type="radio"
                  value={method}
                  disabled={isSubmitting}
                  className="size-16"
                  {...register("evidenceMethod")}
                />
                <span className="body-small font-medium text-[var(--color-text-primary)]">
                  {formatApplicationEvidenceMethod(method)}
                </span>
              </span>
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {evidenceMethodDescriptions[method]}
              </span>
            </label>
          ))}
        </div>

        {evidenceMethod === "boundary" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
            <FormField
              id="gisBoundaryReference"
              label="GIS Boundary Reference"
              error={errors.gisBoundaryReference?.message}
              helperText="Link to GIS layer data"
            >
              <FormInput
                id="gisBoundaryReference"
                type="text"
                placeholder="e.g., https://maps.example.com/dec/plot-a"
                disabled={isSubmitting}
                error={!!errors.gisBoundaryReference}
                {...register("gisBoundaryReference")}
              />
            </FormField>
          </div>
        )}

        <ApplicationEvidencePanel
          applicationId={application?.id}
          mode={evidenceMethod ?? "visual"}
          disabled={isSubmitting}
        />
      </FormSection>

      {/* === Section 4: Soil Temperature === */}
      <FormSection
        title="Soil Temperature"
        icon={<Thermometer size={14} weight="bold" />}
        hint="Used in the Isometric 200-year durability calculation."
        fields={["soilTemperatureSource", "soilTemperatureC"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="soilTemperatureSource"
            label="Temperature Source"
            error={errors.soilTemperatureSource?.message}
          >
            <FormSelect
              id="soilTemperatureSource"
              placeholder="Select source..."
              disabled={isSubmitting}
              error={!!errors.soilTemperatureSource}
              options={soilTemperatureSourceOptions}
              {...register("soilTemperatureSource")}
            />
          </FormField>

          <FormField
            id="soilTemperatureC"
            label="Soil Temperature (°C)"
            error={errors.soilTemperatureC?.message}
            helperText="Annual average for this application site"
            certifyRequired={isApplicationCertifyField("soilTemperatureC")}
            certifyStatus={certStatus("soilTemperatureC")}
          >
            <FormInput
              id="soilTemperatureC"
              type="number"
              step="any"
              placeholder="e.g., 25.0"
              disabled={isSubmitting}
              error={!!errors.soilTemperatureC}
              {...register("soilTemperatureC", {
                setValueAs: numericValue,
              })}
            />
          </FormField>
        </div>
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
