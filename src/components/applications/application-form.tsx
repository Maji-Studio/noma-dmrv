/**
 * ApplicationForm component
 * Reusable application form with React Hook Form integration
 *
 * Form sections:
 * 1. Application details — applicationDate, delivery, biocharAppliedTons + auto-calculated dry mass card
 * 2. Field details — fieldSizeHa, fieldIdentifier, cropType, GPS coordinates
 * 3. Evidence: evidenceMethod and evidence panel
 * 4. Soil temperature — soilTemperatureSource (enum toggle), soilTemperatureC
 */
"use client";

import { numericValue } from "@/lib/form-utils";
import { formatLocalDate } from "@/lib/date-utils";
import { formatDate } from "@/lib/format-utils";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { PackageIcon, MapPinIcon, CameraIcon, ThermometerIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, FormSelect, FormSection, FormSpine, FormActions, makeCertFieldStatus } from "@/components/forms";
import { ResolvedErrorRevalidator } from "@/components/forms";
import { MoistureSplit } from "@/components/ui/moisture-split";
import {
  applicationFormSchema,
  applicationMethods,
  soilTemperatureSources,
  formatApplicationMethod,
  formatSoilTemperatureSource,
  type ApplicationFormData,
  type ApplicationEvidenceMethod,
  type ApplicationMethod,
  type SoilTemperatureSource,
} from "@/schemas/applications";
import type { Application } from "@/db/schema/application";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import { useOrganizationDefaultValues } from "@/hooks/use-organization-settings";
import type { DurabilityOption } from "@/schemas/credit-batches";
import { ApplicationEvidencePanel } from "./application-evidence-panel";
import {
  FieldPositionField,
  resetFieldPosition,
} from "./field-position-field";
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
import { isStockOverdraw } from "@/lib/stock-overdraw";

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

// ============================================
// Dry Mass Calculation Card
// ============================================

/**
 * The applied wet mass split into dry matter and water. Unlike the other
 * mass/moisture surfaces the operator does not type the moisture here — it
 * comes from the chosen delivery — so the panel's job is to explain where the
 * dry figure came from.
 *
 * Without a delivery moisture there is no split to draw, and the unresolved
 * state is already carried by the "Biochar applied, dry (kg)" input this form
 * swaps in — the control the operator has to act on. The panel stays silent
 * rather than restating that input's own helper text beside it.
 */
function AppliedMassSplit({
  appliedKg,
  moisturePercent,
}: {
  appliedKg: number | null | undefined;
  moisturePercent: number | null | undefined;
}) {
  if (moisturePercent == null) return null;

  const hasApplied = appliedKg != null && appliedKg > 0;

  return (
    <div className="col-span-full border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-medium)] px-16 py-12">
      {!hasApplied ? (
        <p className="body-small text-[var(--color-text-tertiary)]">
          Enter the wet mass applied to see the dry mass this delivery&rsquo;s moisture implies.
        </p>
      ) : (
        <MoistureSplit
          wetMassKg={appliedKg}
          moisturePercent={moisturePercent}
          note="Moisture from the delivery record."
        />
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
  /** Submission-level error shown with the action footer */
  errorMessage?: string;
  /** Custom label for the submit button */
  submitLabel?: string;
  /**
   * Facility durability tier (ADR 0021), threaded from the list page's
   * facility context. Soil temperature is a 200-year-only input — under
   * 1000-year the whole Soil Temperature section (and its prefill) is hidden.
   * Defaults to 200-year so an omitted tier never hides a field the operator
   * might need.
   */
  durabilityOption?: DurabilityOption;
  deferredAttachments?: UseDeferredAttachmentsResult;
}

export function ApplicationForm({
  application,
  deliveries = [],
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
  durabilityOption = "200_year",
  deferredAttachments,
}: ApplicationFormProps) {
  const isEditMode = !!application;
  // Soil temperature feeds only the 200-year durable fraction; 1000-year
  // removals derive durability from petrographic reflectance + TGA.
  const hideSoilTemperature = durabilityOption === "1000_year";

  // Organization operating defaults seed create mode only; an existing record
  // always wins. Warmed once per session in FacilityProvider, so this is a
  // cache read rather than a round trip on open.
  const { defaults: orgDefaults } = useOrganizationDefaultValues();

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
    evidenceMethod:
      (application?.evidenceMethod as ApplicationEvidenceMethod | undefined) ??
      orgDefaults.defaultEvidenceMethod,
    gisBoundary: application?.gisBoundary ?? null,
    soilTemperatureSource: (application?.soilTemperatureSource as SoilTemperatureSource) ?? undefined,
    soilTemperatureC: application?.soilTemperatureC ?? undefined,
  };

  const {
    register,
    handleSubmit,
    control,
    trigger,
    setError,
    setValue,
    resetField,
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
  const gisBoundary = useWatch({ control, name: "gisBoundary" });

  // Only delivered deliveries accept applications (issue #284) — undelivered
  // ones stay visible but disabled so operators see why they can't pick them.
  const deliveryOptions = deliveries.map((d) => ({
    value: d.id,
    label:
      d.status === "delivered"
        ? formatApplicationDeliveryOptionLabel(d)
        : `${formatApplicationDeliveryOptionLabel(d)} · not yet delivered`,
    disabled: d.status !== "delivered",
  }));
  const selectedDelivery = deliveries.find((delivery) => delivery.id === selectedDeliveryId);
  const derivedPosition = selectedDelivery
    ? resolveApplicationPositionDefault({ delivery: selectedDelivery })
    : null;
  const fieldPositionDefaultMode =
    application &&
    (application.gpsLatitude !== derivedPosition?.gpsLatitude ||
      application.gpsLongitude !== derivedPosition?.gpsLongitude)
      ? "manual"
      : "derive";

  // Prefill soil temperature from the delivery's customer-location /
  // facility default, but only while the operator hasn't touched the
  // fields (prefills don't set them dirty). While untouched, the values
  // always mirror the selected delivery — including clearing a stale
  // prefill when the new delivery has no default.
  useEffect(() => {
    // No soil-temperature capture under 1000-year — skip the prefill entirely.
    if (isEditMode || !selectedDelivery || hideSoilTemperature) return;

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
  }, [getFieldState, isEditMode, selectedDelivery, setValue, hideSoilTemperature]);

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
  const applicationStockError =
    availableKg !== null &&
    appliedKgValid !== null &&
    isStockOverdraw(appliedKgValid, availableKg)
      ? `Cannot exceed available: ${formatKg(
          availableKg,
        )} remaining from this delivery`
      : undefined;

  const handleFormSubmit = handleSubmit(async (data) => {
    if (applicationStockError) return;

    // Custody ordering (issue #284): the server rejects this too — but a
    // legacy application can still reference an undelivered delivery (the
    // option is disabled yet survives edit-mode defaults), so surface a
    // field error instead of a generic server error.
    if (selectedDelivery && selectedDelivery.status !== "delivered") {
      setError("deliveryId", {
        type: "manual",
        message:
          "This delivery has not been delivered yet — mark it as delivered before recording an application",
      });
      return;
    }

    // Custody ordering (issue #284): the server rejects this too — surface a
    // field error here instead of a generic server error. Day-string compare
    // keeps both sides on local-date granularity.
    if (
      selectedDelivery &&
      formatLocalDate(data.applicationDate) <
        formatLocalDate(new Date(selectedDelivery.deliveryDate))
    ) {
      setError("applicationDate", {
        type: "manual",
        message: `Application date cannot be before the delivery date (${formatDate(selectedDelivery.deliveryDate)})`,
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
      gisBoundary: data.evidenceMethod === "boundary" ? data.gisBoundary : null,
    });
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      <FormSpine control={control}>
      {/* === Section 1: Application Details === */}
      <FormSection
        title="Application details"
        icon={<PackageIcon size={14} weight="bold" />}
        fields={["applicationDate", "deliveryId", "biocharAppliedTons", "biocharAppliedDryTons"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="applicationDate" label="Application date" error={errors.applicationDate?.message} required>
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
            label="Biochar applied, wet (kg)"
            error={
              errors.biocharAppliedTons?.message ??
              applicationStockError
            }
            required
            certifyRequired={isApplicationCertifyField("biocharAppliedTons")}
            certifyStatus={certStatus("biocharAppliedTons")}
            hint="As-received mass at delivery, water included."
            helperText={
              availableKg !== null
                ? `${formatKg(availableKg)} available from this delivery`
                : undefined
            }
          >
            <FormInput
              id="biocharAppliedTons"
              type="number"
              step="any"
              placeholder="e.g., 5000"
              disabled={isSubmitting}
              error={
                !!errors.biocharAppliedTons ||
                !!applicationStockError
              }
              {...register("biocharAppliedTons", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          {/* Show manual dry input only when delivery has no moisture data */}
          {moisturePercent == null && selectedDelivery && (
            <FormField
              id="biocharAppliedDryTons"
              label="Biochar applied, dry (kg)"
              error={errors.biocharAppliedDryTons?.message}
              helperText="No moisture on delivery — enter dry mass manually"
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

          <AppliedMassSplit
            appliedKg={appliedKgValid}
            moisturePercent={moisturePercent}
          />
        </div>
      </FormSection>

      {/* === Section 2: Field Details === */}
      <FormSection
        title="Field details"
        icon={<MapPinIcon size={14} weight="bold" />}
        fields={["fieldSizeHa", "fieldIdentifier", "cropType", "applicationMethodType", "gpsLatitude", "gpsLongitude"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="fieldSizeHa" label="Field size (ha)" error={errors.fieldSizeHa?.message}>
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
            label="Field identifier"
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
          <FormField id="cropType" label="Crop type" error={errors.cropType?.message}>
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
            label="Application method"
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

        <FieldPositionField
          derived={derivedPosition}
          hasDelivery={!!selectedDelivery}
          latitude={gpsLatitude ?? null}
          longitude={gpsLongitude ?? null}
          defaultMode={fieldPositionDefaultMode}
          onPositionChange={({ lat, lng }) => {
            setValue("gpsLatitude", lat, { shouldDirty: true, shouldValidate: true });
            setValue("gpsLongitude", lng, { shouldDirty: true, shouldValidate: true });
          }}
          onDerive={() => resetFieldPosition(resetField, derivedPosition)}
          latitudeError={errors.gpsLatitude?.message}
          longitudeError={errors.gpsLongitude?.message}
          disabled={isSubmitting}
        />

      </FormSection>

      {/* === Section 3: Evidence === */}
      {/* Named "Evidence", not "Evidence method": the section carries the
          declared method AND what proves it (GIS reference, uploaded files). */}
      <FormSection
        title="Evidence"
        icon={<CameraIcon size={14} weight="bold" />}
        hint="Record the application area as a GIS reference and retain a dated logbook record for the quantity applied."
        fields={["evidenceMethod", "gisBoundary"]}
      >
        <ApplicationEvidencePanel
          applicationId={application?.id}
          mode={evidenceMethod ?? "boundary"}
          boundary={gisBoundary ?? null}
          disabled={isSubmitting}
          deferredAttachments={deferredAttachments}
          onModeChange={(nextMode) =>
            setValue("evidenceMethod", nextMode, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
          onBoundaryChange={(nextBoundary) =>
            setValue("gisBoundary", nextBoundary, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        />
      </FormSection>

      {/* === Section 4: Soil Temperature (200-year only) === */}
      {/* Hidden under 1000-year durability — soil temperature feeds only the
          Woolf 2021 200-year durable fraction (ADR 0021). */}
      {!hideSoilTemperature && (
      <FormSection
        title="Soil temperature"
        icon={<ThermometerIcon size={14} weight="bold" />}
        hint="Used in the Isometric 200-year durability calculation."
        fields={["soilTemperatureSource", "soilTemperatureC"]}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="soilTemperatureSource"
            label="Temperature source"
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
            label="Soil temperature (°C)"
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
      )}
      </FormSpine>

      <FormActions
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
