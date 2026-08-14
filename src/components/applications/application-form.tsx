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

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { PackageIcon, MapPinIcon, CameraIcon, ThermometerIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, FormSelect, FormSection, FormSpine, FormActions, makeCertFieldStatus } from "@/components/forms";
import { ResolvedErrorRevalidator } from "@/components/forms";
import { ProductCompositionPreview } from "@/components/ui/product-composition-preview";
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
import { useInlineStockServerError } from "@/hooks/use-inline-stock-server-error";
import type { DurabilityOption } from "@/schemas/credit-batches";
import { ApplicationEvidencePanel } from "./application-evidence-panel";
import {
  FieldPositionField,
  resetFieldPosition,
} from "./field-position-field";
import type { FieldPositionMode } from "./field-position-field";
import {
  applicationKgToTons,
  applicationTonsToKg,
  formatApplicationDeliveryHelperText,
  formatApplicationDeliveryOptionLabel,
  resolveApplicationPositionDefault,
  resolveApplicationSoilTemperatureDefault,
  type ApplicationDeliveryOption,
} from "./mass-utils";
import {
  deliveryStockOverdrawMessage,
  formatStockLimitKg,
  isStockOverdraw,
} from "@/lib/stock-overdraw";
import { allocateTrackedDryBiocharKg } from "@/lib/biochar-mass-accounting";

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
 * Applied product composition based on the selected delivery's tracked dry
 * biochar. Delivery moisture is displayed as evidence only.
 */
function AppliedMassSplit({
  appliedKg,
  dryBiocharKg,
  moisturePercent,
}: {
  appliedKg: number | null | undefined;
  dryBiocharKg: number | null | undefined;
  moisturePercent: number | null | undefined;
}) {
  return (
    <ProductCompositionPreview
      className="col-span-full"
      wetMassKg={appliedKg}
      dryBiocharKg={dryBiocharKg}
      moisturePercent={moisturePercent}
      wetLabel="Biochar product applied"
      note="Dry biochar follows the selected delivery's tracked composition."
    />
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

  const defaultValues = {
    applicationDate: application?.applicationDate
      ? formatLocalDate(new Date(application.applicationDate))
      : formatLocalDate(new Date()),
    deliveryId: application?.deliveryId ?? "",
    biocharAppliedTons: applicationTonsToKg(application?.biocharAppliedTons) ?? undefined,
    fieldSizeHa: application?.fieldSizeHa ?? undefined,
    fieldIdentifier: application?.fieldIdentifier ?? "",
    cropType: application?.cropType ?? "",
    gpsLatitude: application?.gpsLatitude ?? undefined,
    gpsLongitude: application?.gpsLongitude ?? undefined,
    applicationMethodType: (application?.applicationMethodType as ApplicationMethod) ?? undefined,
    // The visual path remains UI-locked ("Available later"). Customer location
    // is the default v1.1 proof path for new applications.
    evidenceMethod:
      (application?.evidenceMethod as ApplicationEvidenceMethod | undefined) ??
      "location",
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

  // The saved record's own delivery, not the currently selected one: the mode
  // a stored application opens in must not flip just because the operator
  // picked a different delivery, and it stays unresolved (so it defaults to
  // derive) until the deliveries query settles rather than latching to manual.
  const savedDelivery = application
    ? deliveries.find((delivery) => delivery.id === application.deliveryId)
    : undefined;
  const savedDerivedPosition = savedDelivery
    ? resolveApplicationPositionDefault({ delivery: savedDelivery })
    : null;
  const fieldPositionDefaultMode: FieldPositionMode =
    application &&
    savedDelivery &&
    (application.gpsLatitude !== savedDerivedPosition?.gpsLatitude ||
      application.gpsLongitude !== savedDerivedPosition?.gpsLongitude)
      ? "manual"
      : "derive";
  // Null until the operator picks a mode, so the resolved mode keeps tracking
  // the record while they have expressed no preference.
  const [pickedFieldPositionMode, setPickedFieldPositionMode] =
    useState<FieldPositionMode | null>(null);
  const fieldPositionMode = pickedFieldPositionMode ?? fieldPositionDefaultMode;

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

  // In derive mode the position always mirrors the selected delivery's
  // destination — on an edit too, so changing the delivery cannot leave the
  // previous coordinates in form state behind a summary showing the new ones.
  // It also clears a stale position when the new destination has no GPS.
  // Manual mode owns the fields outright and is never overwritten here.
  const derivedLatitude = derivedPosition?.gpsLatitude;
  const derivedLongitude = derivedPosition?.gpsLongitude;
  useEffect(() => {
    if (fieldPositionMode !== "derive" || !selectedDelivery) return;

    setValue("gpsLatitude", derivedLatitude, {
      shouldDirty: false,
      shouldValidate: true,
    });
    setValue("gpsLongitude", derivedLongitude, {
      shouldDirty: false,
      shouldValidate: true,
    });
  }, [
    derivedLatitude,
    derivedLongitude,
    fieldPositionMode,
    selectedDelivery,
    setValue,
  ]);

  const moisturePercent = selectedDelivery?.moistureContentPercent ?? null;
  const appliedKgNum = typeof watchedAppliedKg === "string" ? parseFloat(watchedAppliedKg) : watchedAppliedKg;
  const appliedKgValid = appliedKgNum != null && !isNaN(appliedKgNum) && appliedKgNum > 0 ? appliedKgNum : null;

  // Remaining capacity for the selected delivery
  const deliveryCapacityKg = selectedDelivery?.deliveredWetMassKg ?? null;
  const alreadyApplied = selectedDelivery?.alreadyAppliedWetKg ?? null;
  const isSameDelivery = isEditMode && application?.deliveryId === selectedDeliveryId;
  const currentApplicationKg = isSameDelivery
    ? applicationTonsToKg(application?.biocharAppliedTons)
    : 0;
  const currentApplicationDryKg = isSameDelivery
    ? applicationTonsToKg(application?.biocharAppliedDryTons)
    : 0;
  const alreadyAppliedDryKg = selectedDelivery?.alreadyAppliedDryKg ?? null;
  const availableKg =
    deliveryCapacityKg !== null &&
    alreadyApplied !== null &&
    currentApplicationKg !== null
      ? deliveryCapacityKg - alreadyApplied + currentApplicationKg
      : null;
  const allocationsKnown =
    alreadyApplied !== null &&
    alreadyAppliedDryKg !== null &&
    currentApplicationKg !== null &&
    currentApplicationDryKg !== null;
  const appliedDryBiocharKg = allocationsKnown
    ? allocateTrackedDryBiocharKg({
        totalWetKg: deliveryCapacityKg,
        totalDryBiocharKg: selectedDelivery?.massDryKg ?? null,
        requestedWetKg: appliedKgValid,
        allocatedWetKg: Math.max(0, alreadyApplied - currentApplicationKg),
        allocatedDryBiocharKg: Math.max(
          0,
          alreadyAppliedDryKg - currentApplicationDryKg,
        ),
      })
    : null;
  const applicationStockError =
    availableKg !== null &&
    appliedKgValid !== null &&
    isStockOverdraw(appliedKgValid, availableKg)
      ? `Only ${formatStockLimitKg(availableKg)} remains in this delivery. Reduce the applied mass.`
      : undefined;
  const applicationMassFingerprint = [
    selectedDeliveryId,
    watchedAppliedKg,
  ].join(":");
  const routedServerError = useInlineStockServerError(
    errorMessage,
    applicationMassFingerprint,
    (message) => message === deliveryStockOverdrawMessage(),
  );
  const biocharAppliedError =
    errors.biocharAppliedTons?.message ??
    applicationStockError ??
    routedServerError.inlineError;

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
          "This delivery is not marked as delivered. Mark it as delivered before recording an application.",
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

    if (biocharAppliedTons == null) {
      throw new Error("Biochar product applied is required");
    }

    if (appliedDryBiocharKg == null) {
      setError("root.serverError", {
        type: "manual",
        message: "Tracked dry biochar is not available for this delivery. Update the delivery first.",
      });
      return;
    }

    await onSubmit({
      ...data,
      biocharAppliedTons,
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
        fields={["applicationDate", "deliveryId", "biocharAppliedTons"]}
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
            label="Biochar product applied (kg)"
            error={biocharAppliedError}
            required
            certifyRequired={isApplicationCertifyField("biocharAppliedTons")}
            certifyStatus={certStatus("biocharAppliedTons")}
            hint="As-received mass at delivery, water included."
            helperText={
              availableKg !== null
                ? `${formatStockLimitKg(availableKg)} available from this delivery`
                : undefined
            }
          >
            <FormInput
              id="biocharAppliedTons"
              type="number"
              step="any"
              placeholder="e.g., 5000"
              disabled={isSubmitting}
              error={!!biocharAppliedError}
              {...register("biocharAppliedTons", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <AppliedMassSplit
            appliedKg={appliedKgValid}
            dryBiocharKg={appliedDryBiocharKg}
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
          mode={fieldPositionMode}
          onModeChange={setPickedFieldPositionMode}
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
        hint="Choose one way to identify where the biochar was applied."
        fields={["evidenceMethod", "gisBoundary"]}
      >
        <ApplicationEvidencePanel
          applicationId={application?.id}
          mode={evidenceMethod ?? "location"}
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
        control={control}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={routedServerError.footerError}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
