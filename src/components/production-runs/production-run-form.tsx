/**
 * ProductionRunForm component
 * Reusable production run form with React Hook Form integration
 * Uses bin-based feedstock selection with proportional allocation
 */
"use client";

import { nullableNumericValue, integerValue } from "@/lib/form-utils";
import { formatLocalDate, formatLocalTime, combineDateAndTime } from "@/lib/date-utils";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { useFacilityContext } from "@/hooks/use-facility-context";

import { useEffect, useId, useRef } from "react";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FactoryIcon, PlantIcon, LightningIcon, PackageIcon, FlowArrowIcon, FileCsvIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, DryMassInput, FormActions, FormSection, FormSpine, SectionLabel, makeCertFieldStatus, type CertFieldStatus } from "@/components/forms";
import { ProductionReadingsDocuments } from "./production-readings-documents";
import { FormSelect } from "@/components/forms/form-select";
import { EntitySelect } from "@/components/forms/entity-select";
import { useEntityById } from "@/hooks/use-entities";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import {
  productionRunFormSchema,
  productionRunStatuses,
  formatProductionRunStatus,
  type ProductionRunFormData,
  type ProductionRunStatus,
} from "@/schemas/production-runs";
import type { ProductionRunWithRelations } from "@/data-access/production-runs";

// ============================================
// Constants for select options
// ============================================

const statusOptions: readonly { value: string; label: string }[] = productionRunStatuses.map((status) => ({
  value: status,
  label: formatProductionRunStatus(status),
}));

const isProductionRunCertifyField = (field: string) =>
  isCertifyFormField("productionRun", field);

// ============================================
// Process Flow Visual
// ============================================

function ProcessFlowPreview({
  sourceBinName,
  feedstockKg,
  feedstockDryKg,
  reactorName,
  biocharKg,
  biocharDryKg,
  destinationBinName,
}: {
  sourceBinName: string | null;
  feedstockKg: number | null;
  feedstockDryKg: number | null;
  reactorName: string | null;
  biocharKg: number | null;
  biocharDryKg: number | null;
  destinationBinName: string | null;
}) {
  const hasSource = !!sourceBinName;
  const hasFeedstock = feedstockKg !== null && feedstockKg > 0;
  const hasReactor = !!reactorName;
  const hasBiochar = biocharKg !== null && biocharKg > 0;
  const hasDestination = !!destinationBinName;

  if (!hasSource && !hasReactor && !hasDestination) return null;

  const useDry = feedstockDryKg !== null && biocharDryKg !== null;
  const yieldPercent =
    hasFeedstock && hasBiochar
      ? useDry
        ? feedstockDryKg > 0
          ? ((biocharDryKg! / feedstockDryKg!) * 100).toFixed(1)
          : null
        : feedstockKg > 0
          ? ((biocharKg / feedstockKg) * 100).toFixed(1)
          : null
      : null;

  return (
    <div className="flex items-stretch gap-0 text-center">
      {/* Source bin */}
      <div
        className={`flex-1 border px-12 py-10 flex flex-col justify-center transition-colors ${
          hasSource
            ? "border-[var(--color-border-primary)] bg-[var(--color-bg-tertiary)]"
            : "border-dashed border-[var(--color-border-tertiary)] bg-transparent"
        }`}
      >
        <span className="body-caption text-[var(--color-text-tertiary)] uppercase tracking-[0.06em]">
          Input
        </span>
        {hasSource ? (
          <>
            <span className="body-small font-medium text-[var(--color-text-primary)] mt-2">
              {sourceBinName}
            </span>
            {hasFeedstock && (
              <>
                <span className="body-caption text-[var(--color-text-secondary)] mt-1">
                  {feedstockKg.toLocaleString()} kg wet
                </span>
                {feedstockDryKg !== null && (
                  <span className="body-caption text-[var(--color-text-tertiary)]">
                    {feedstockDryKg.toLocaleString()} kg dry
                  </span>
                )}
              </>
            )}
          </>
        ) : (
          <span className="body-small text-[var(--color-text-quaternary)] mt-2">
            Select bin
          </span>
        )}
      </div>

      {/* Arrow to reactor */}
      <div className="flex items-center justify-center px-4">
        <svg width="24" height="16" viewBox="0 0 24 16" fill="none" className="text-[var(--color-text-tertiary)]">
          <path d="M0 8H18M18 8L13 3M18 8L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Reactor / machine */}
      <div
        className={`flex-1 border px-12 py-10 flex flex-col items-center justify-center transition-colors ${
          hasReactor
            ? "border-[var(--color-border-primary)] bg-[var(--color-bg-tertiary)]"
            : "border-dashed border-[var(--color-border-tertiary)] bg-transparent"
        }`}
      >
        {/* Reactor icon */}
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-[var(--color-text-tertiary)] mb-2">
          <rect x="3" y="4" width="14" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />
          <path d="M7 1v3M13 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M6 10h8M6 13h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
        </svg>
        {hasReactor ? (
          <span className="body-small font-medium text-[var(--color-text-primary)]">
            {reactorName}
          </span>
        ) : (
          <span className="body-small text-[var(--color-text-quaternary)]">
            Select reactor
          </span>
        )}
        {yieldPercent && (
          <span className="body-caption text-[var(--color-text-secondary)] mt-1">
            {yieldPercent}% yield{useDry ? " (dry)" : " (wet)"}
          </span>
        )}
      </div>

      {/* Arrow to output */}
      <div className="flex items-center justify-center px-4">
        <svg width="24" height="16" viewBox="0 0 24 16" fill="none" className="text-[var(--color-text-tertiary)]">
          <path d="M0 8H18M18 8L13 3M18 8L13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Destination bin */}
      <div
        className={`flex-1 border px-12 py-10 flex flex-col justify-center transition-colors ${
          hasDestination
            ? "border-[var(--color-border-primary)] bg-[var(--color-bg-tertiary)]"
            : "border-dashed border-[var(--color-border-tertiary)] bg-transparent"
        }`}
      >
        <span className="body-caption text-[var(--color-text-tertiary)] uppercase tracking-[0.06em]">
          Output
        </span>
        {hasDestination ? (
          <>
            <span className="body-small font-medium text-[var(--color-text-primary)] mt-2">
              {destinationBinName}
            </span>
            {hasBiochar && (
              <>
                <span className="body-caption text-[var(--color-text-secondary)] mt-1">
                  {biocharKg.toLocaleString()} kg wet
                </span>
                {biocharDryKg !== null && (
                  <span className="body-caption text-[var(--color-text-tertiary)]">
                    {biocharDryKg.toLocaleString()} kg dry
                  </span>
                )}
              </>
            )}
          </>
        ) : (
          <span className="body-small text-[var(--color-text-quaternary)] mt-2">
            Select bin
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================
// Component
// ============================================

interface ProductionRunFormProps {
  /** Existing production run data for editing (undefined for create mode) */
  productionRun?: ProductionRunWithRelations;
  /** Form submission handler */
  onSubmit: (data: ProductionRunFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
  /**
   * Extension content (e.g. readings/samples/incidents tables) rendered
   * between the form fields and the CTA row — outside the `<form>` element,
   * so it may contain its own forms. Nothing ever renders after the CTA.
   */
  children?: React.ReactNode;
}

export function ProductionRunForm({
  productionRun,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  children,
}: ProductionRunFormProps) {
  const formId = useId();
  const isEditMode = !!productionRun;
  const { facilityId: contextFacilityId } = useFacilityContext();

  const defaultValues = {
    facilityId: productionRun?.facilityId || contextFacilityId || "",
    date: productionRun?.date ?? formatLocalDate(new Date()),
    reactorId: productionRun?.reactorId ?? "",
    status: (productionRun?.status as ProductionRunStatus) ?? "draft",
    startTime: productionRun?.startTime
      ? formatLocalTime(new Date(productionRun.startTime))
      : formatLocalTime(new Date()),
    endTime: productionRun?.endTime ? formatLocalTime(new Date(productionRun.endTime)) : "",
    operatorId: productionRun?.operatorId ?? "",
    feedstockStorageLocationId: productionRun?.feedstockStorageLocationId ?? "",
    feedstockWetMassKg: productionRun?.feedstockWetMassKg ?? undefined,
    feedstockMoisturePercent: productionRun?.feedstockMoisturePercent ?? undefined,
    feedingRateKgHr: productionRun?.feedingRateKgHr ?? undefined,
    residenceTimeMinutes: productionRun?.residenceTimeMinutes ?? undefined,
    dieselOperationLiters: productionRun?.dieselOperationLiters ?? undefined,
    dieselGensetLiters: productionRun?.dieselGensetLiters ?? undefined,
    preprocessingFuelLiters: productionRun?.preprocessingFuelLiters ?? undefined,
    electricityKwh: productionRun?.electricityKwh ?? undefined,
    biocharOutputKg: productionRun?.biocharOutputKg ?? undefined,
    biocharMoisturePercent: productionRun?.biocharMoisturePercent ?? undefined,
    biocharStorageLocationId: productionRun?.biocharStorageLocationId ?? "",
  };

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(productionRunFormSchema),
    // onTouched so the spine markers can turn red on blur, not just on submit.
    mode: "onTouched",
    defaultValues,
  });

  // CERT chips reflect the saved record (frozen), neutral while creating.
  const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);
  // The run-status chip is satisfied only once the saved run is marked Complete
  // (a run must be Complete before it's certification-ready), not merely set.
  const runStatusCertStatus: CertFieldStatus = !isEditMode
    ? "neutral"
    : productionRun?.status === "complete"
      ? "satisfied"
      : "missing";

  // Watch facility to filter reactors and storage locations
  const watchedFacilityId = useWatch({ control, name: "facilityId" });

  // Watch fields for flow preview
  const watchedReactorId = useWatch({ control, name: "reactorId" });
  const watchedSourceBinId = useWatch({ control, name: "feedstockStorageLocationId" });
  const watchedDestBinId = useWatch({ control, name: "biocharStorageLocationId" });
  const watchedBiocharKg = useWatch({ control, name: "biocharOutputKg" });
  const watchedBiocharMoisture = useWatch({ control, name: "biocharMoisturePercent" });

  // Entity lookups for flow preview labels
  const { data: selectedReactor } = useEntityById("reactor", watchedReactorId || undefined);
  const { data: selectedSourceBin } = useEntityById("storageLocation", watchedSourceBinId || undefined);
  const { data: selectedDestBin } = useEntityById("storageLocation", watchedDestBinId || undefined);

  // Watch wet mass + moisture for dry mass preview
  const watchWetMass = useWatch({ control, name: "feedstockWetMassKg" });
  const watchMoisture = useWatch({ control, name: "feedstockMoisturePercent" });

  const previewDryMass =
    typeof watchWetMass === "number" &&
    typeof watchMoisture === "number" &&
    watchWetMass >= 0 &&
    watchMoisture >= 0 &&
    watchMoisture <= 100
      ? deriveMassDryKg(watchWetMass, watchMoisture)
      : null;

  const previewBiocharDryMass =
    typeof watchedBiocharKg === "number" &&
    typeof watchedBiocharMoisture === "number" &&
    watchedBiocharKg >= 0 &&
    watchedBiocharMoisture >= 0 &&
    watchedBiocharMoisture <= 100
      ? deriveMassDryKg(watchedBiocharKg, watchedBiocharMoisture)
      : null;

  // Track previous facility to detect real changes
  const prevFacilityRef = useRef(watchedFacilityId);

  // Sync facilityId from context when creating (context may load after mount)
  useEffect(() => {
    if (!productionRun && contextFacilityId && contextFacilityId !== watchedFacilityId) {
      setValue("facilityId", contextFacilityId);
    }
  }, [productionRun, contextFacilityId, watchedFacilityId, setValue]);

  // Clear dependent fields when facility actually changes
  useEffect(() => {
    if (prevFacilityRef.current && watchedFacilityId !== prevFacilityRef.current && !productionRun) {
      setValue("reactorId", "");
      setValue("feedstockStorageLocationId", "");
      setValue("biocharStorageLocationId", "");
    }
    prevFacilityRef.current = watchedFacilityId;
  }, [watchedFacilityId, setValue, productionRun]);

  const defaultSubmitLabel = isEditMode ? "Update Production Run" : "Create Production Run";

  const handleFormSubmit = handleSubmit((data) => {
    // date comes as "YYYY-MM-DD" string from the input
    const dateStr = typeof data.date === "string" ? data.date : formatLocalDate(data.date as Date);
    const combined = {
      ...data,
      date: new Date(dateStr + "T00:00:00"), // local midnight
      startTime: combineDateAndTime(dateStr, data.startTime as string),
      endTime: data.endTime ? combineDateAndTime(dateStr, data.endTime as string) : undefined,
    };
    return onSubmit(combined as ProductionRunFormData);
  });

  return (
    <div className="space-y-20">
      <form id={formId} onSubmit={handleFormSubmit}>
      <FormSpine control={control}>
      {/* ── Run Setup ── */}
      <FormSection
        title="Run Setup"
        icon={<FactoryIcon size={14} weight="bold" />}
        fields={["reactorId", "status", "date", "operatorId", "startTime", "endTime"]}
      >

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField id="reactorId" label="Reactor" error={errors.reactorId?.message} required>
            <Controller
              name="reactorId"
              control={control}
              render={({ field }) => (
                <EntitySelect
                  entityType="reactor"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select a reactor..."
                  disabled={isSubmitting || !watchedFacilityId}
                  error={!!errors.reactorId}
                  filterBy={watchedFacilityId ? { facilityId: watchedFacilityId } : undefined}
                  autoSelectSingle
                />
              )}
            />
          </FormField>

          <FormField
            id="status"
            label="Status"
            error={errors.status?.message}
            helperText="Mark finished runs Complete before certification."
            certifyRequired
            certifyStatus={runStatusCertStatus}
          >
            <FormSelect
              id="status"
              disabled={isSubmitting}
              error={!!errors.status}
              options={statusOptions}
              {...register("status")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField id="date" label="Date" error={errors.date?.message} required>
            <FormInput id="date" type="date" disabled={isSubmitting} error={!!errors.date} {...register("date")} />
          </FormField>

          <FormField id="operatorId" label="Operator" error={errors.operatorId?.message}>
            <Controller
              name="operatorId"
              control={control}
              render={({ field }) => (
                <EntitySelect
                  entityType="operator"
                  value={field.value || undefined}
                  onChange={field.onChange}
                  placeholder="Select operator..."
                  disabled={isSubmitting}
                  error={!!errors.operatorId}
                />
              )}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField id="startTime" label="Start Time" error={errors.startTime?.message} required>
            <FormInput
              id="startTime"
              type="time"
              disabled={isSubmitting}
              error={!!errors.startTime}
              {...register("startTime")}
            />
          </FormField>

          <FormField id="endTime" label="End Time" error={errors.endTime?.message}>
            <FormInput
              id="endTime"
              type="time"
              disabled={isSubmitting}
              error={!!errors.endTime}
              {...register("endTime")}
            />
          </FormField>
        </div>
      </FormSection>

      {/* ── Feedstock & Processing ── */}
      <FormSection
        title="Feedstock & Processing"
        icon={<PlantIcon size={14} weight="bold" />}
        fields={[
          "feedstockStorageLocationId",
          "feedstockWetMassKg",
          "feedstockMoisturePercent",
          "feedingRateKgHr",
          "residenceTimeMinutes",
        ]}
      >

        {!watchedFacilityId && (
          <p className="text-[var(--color-text-tertiary)] body-caption">
            Select a facility in the sidebar to choose a feedstock source bin.
          </p>
        )}
        <FormField
          id="feedstockStorageLocationId"
          label="Source Bin"
          error={errors.feedstockStorageLocationId?.message}
        >
          <Controller
            name="feedstockStorageLocationId"
            control={control}
            render={({ field }) => (
              <EntitySelect
                entityType="storageLocation"
                value={field.value || undefined}
                onChange={field.onChange}
                placeholder="Select bin..."
                disabled={isSubmitting || !watchedFacilityId}
                error={!!errors.feedstockStorageLocationId}
                filterBy={watchedFacilityId ? { facilityId: watchedFacilityId, type: "feedstock_bin", feedstockTypeUsage: "pyrolysis" } : undefined}
              />
            )}
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="feedstockWetMassKg"
            label="Wet Mass (kg)"
            error={errors.feedstockWetMassKg?.message}
            certifyRequired={isProductionRunCertifyField("feedstockWetMassKg")}
            certifyStatus={certStatus("feedstockWetMassKg")}
          >
            <DryMassInput
              id="feedstockWetMassKg"
              type="number"
              step="0.1"
              placeholder="e.g. 500"
              disabled={isSubmitting}
              error={!!errors.feedstockWetMassKg}
              wetMassKg={watchWetMass}
              moisturePercent={watchMoisture}
              {...register("feedstockWetMassKg", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="feedstockMoisturePercent"
            label="Moisture Content (%)"
            error={errors.feedstockMoisturePercent?.message}
            certifyRequired={isProductionRunCertifyField("feedstockMoisturePercent")}
            certifyStatus={certStatus("feedstockMoisturePercent")}
          >
            <FormInput
              id="feedstockMoisturePercent"
              type="number"
              step="0.1"
              placeholder="e.g. 15"
              disabled={isSubmitting}
              error={!!errors.feedstockMoisturePercent}
              {...register("feedstockMoisturePercent", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField id="feedingRateKgHr" label="Feed Rate (kg/hr)" error={errors.feedingRateKgHr?.message}>
            <FormInput
              id="feedingRateKgHr"
              type="number"
              step="0.1"
              placeholder="e.g. 420"
              disabled={isSubmitting}
              error={!!errors.feedingRateKgHr}
              {...register("feedingRateKgHr", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField id="residenceTimeMinutes" label="Residence Time (min)" error={errors.residenceTimeMinutes?.message}>
            <FormInput
              id="residenceTimeMinutes"
              type="number"
              step="1"
              placeholder="e.g. 30"
              disabled={isSubmitting}
              error={!!errors.residenceTimeMinutes}
              {...register("residenceTimeMinutes", {
                setValueAs: integerValue,
              })}
            />
          </FormField>
        </div>
      </FormSection>

      {/* ── Output ── */}
      <FormSection
        title="Output"
        icon={<PackageIcon size={14} weight="bold" />}
        fields={[
          "biocharStorageLocationId",
          "biocharOutputKg",
          "biocharMoisturePercent",
        ]}
      >

        <FormField
          id="biocharStorageLocationId"
          label="Biochar Storage"
          error={errors.biocharStorageLocationId?.message}
        >
          <Controller
            name="biocharStorageLocationId"
            control={control}
            render={({ field }) => (
              <EntitySelect
                entityType="storageLocation"
                value={field.value || undefined}
                onChange={field.onChange}
                placeholder="Select storage..."
                disabled={isSubmitting || !watchedFacilityId}
                error={!!errors.biocharStorageLocationId}
                filterBy={watchedFacilityId ? { facilityId: watchedFacilityId, type: "biochar_bin" } : undefined}
              />
            )}
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="biocharOutputKg"
            label="Biochar Wet Mass (kg)"
            error={errors.biocharOutputKg?.message}
            certifyRequired={isProductionRunCertifyField("biocharOutputKg")}
            certifyStatus={certStatus("biocharOutputKg")}
          >
            <DryMassInput
              id="biocharOutputKg"
              type="number"
              step="0.1"
              placeholder="e.g. 150"
              disabled={isSubmitting}
              error={!!errors.biocharOutputKg}
              wetMassKg={watchedBiocharKg}
              moisturePercent={watchedBiocharMoisture}
              {...register("biocharOutputKg", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
          <FormField
            id="biocharMoisturePercent"
            label="Biochar Moisture (%)"
            error={errors.biocharMoisturePercent?.message}
            certifyRequired={isProductionRunCertifyField("biocharMoisturePercent")}
            certifyStatus={certStatus("biocharMoisturePercent")}
          >
            <FormInput
              id="biocharMoisturePercent"
              type="number"
              step="0.1"
              placeholder="e.g. 1.5"
              disabled={isSubmitting}
              error={!!errors.biocharMoisturePercent}
              {...register("biocharMoisturePercent", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
        </div>
      </FormSection>

      {/* ── Energy ── */}
      <FormSection
        title="Energy"
        icon={<LightningIcon size={14} weight="bold" />}
        fields={[
          "dieselOperationLiters",
          "dieselGensetLiters",
          "preprocessingFuelLiters",
          "electricityKwh",
        ]}
      >

        <p className="body-caption text-[var(--color-text-tertiary)]">
          These values feed the certification emissions calculation. Enter 0
          where nothing was used — a blank field reads as missing, not zero.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="dieselOperationLiters"
            label="Startup / Plant Diesel (L)"
            hint="Diesel for reactor startup and running on-site plant equipment during this run — not the generator. Shown as “Startup / Plant Diesel” on the Energy page."
            error={errors.dieselOperationLiters?.message}
            certifyRequired={isProductionRunCertifyField("dieselOperationLiters")}
            certifyStatus={certStatus("dieselOperationLiters")}
          >
            <FormInput
              id="dieselOperationLiters"
              type="number"
              step="0.1"
              placeholder="50"
              disabled={isSubmitting}
              error={!!errors.dieselOperationLiters}
              {...register("dieselOperationLiters", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="dieselGensetLiters"
            label="Genset Diesel (L)"
            hint="Diesel burned by the generator that supplied this run's electricity."
            error={errors.dieselGensetLiters?.message}
            certifyRequired={isProductionRunCertifyField("dieselGensetLiters")}
            certifyStatus={certStatus("dieselGensetLiters")}
          >
            <FormInput
              id="dieselGensetLiters"
              type="number"
              step="0.1"
              placeholder="25"
              disabled={isSubmitting}
              error={!!errors.dieselGensetLiters}
              {...register("dieselGensetLiters", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="preprocessingFuelLiters"
            label="Preprocess Fuel (L)"
            hint="Fuel used to dry, chip, or otherwise prepare the feedstock before pyrolysis."
            error={errors.preprocessingFuelLiters?.message}
            certifyRequired={isProductionRunCertifyField("preprocessingFuelLiters")}
            certifyStatus={certStatus("preprocessingFuelLiters")}
          >
            <FormInput
              id="preprocessingFuelLiters"
              type="number"
              step="0.1"
              placeholder="10"
              disabled={isSubmitting}
              error={!!errors.preprocessingFuelLiters}
              {...register("preprocessingFuelLiters", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="electricityKwh"
            label="Electricity (kWh)"
            hint="Grid (or other non-generator) electricity consumed during this run."
            error={errors.electricityKwh?.message}
            certifyRequired={isProductionRunCertifyField("electricityKwh")}
            certifyStatus={certStatus("electricityKwh")}
          >
            <FormInput
              id="electricityKwh"
              type="number"
              step="0.1"
              placeholder="100"
              disabled={isSubmitting}
              error={!!errors.electricityKwh}
              {...register("electricityKwh", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
        </div>

      </FormSection>

      {/* ── Readings CSV Import ── */}
      <FormSection title="Readings CSV Import" icon={<FileCsvIcon size={14} weight="bold" />}>

        <FormField
          id="readingsCsv"
          label="Readings CSV"
          helperText="Upload a readings CSV (timestamp_utc, temperature_c, pressure_bar, plus optional dryer/reactor frequency). A file may span multiple UTC days; rows inside the run's time window populate the readings table below."
          certifyRequired
        >
          {isEditMode && productionRun ? (
            <ProductionReadingsDocuments productionRunId={productionRun.id} />
          ) : (
            <p className="body-small text-[var(--color-text-secondary)]">
              Save the production run first, then reopen it to attach readings
              CSV files.
            </p>
          )}
        </FormField>
      </FormSection>
      </FormSpine>

      {/* Process Flow — a derived recap of the run, not a data-entry step, so
          it lives outside the numbered spine and only appears once there's
          something to show. */}
      {(watchedReactorId || watchedSourceBinId || watchedDestBinId) && (
        <div className="space-y-12 border-t border-[var(--color-border-tertiary)] pt-20">
          <SectionLabel icon={<FlowArrowIcon size={14} weight="bold" />}>
            Process Flow
          </SectionLabel>
          <ProcessFlowPreview
            sourceBinName={selectedSourceBin?.name ?? null}
            feedstockKg={typeof watchWetMass === "number" ? watchWetMass : null}
            feedstockDryKg={previewDryMass}
            reactorName={selectedReactor?.name ?? null}
            biocharKg={typeof watchedBiocharKg === "number" ? watchedBiocharKg : null}
            biocharDryKg={previewBiocharDryMass}
            destinationBinName={selectedDestBin?.name ?? null}
          />
        </div>
      )}
      </form>

      {/* ── Extension content (e.g. readings/samples/incidents) — always before the CTA ── */}
      {children}

      <FormActions
        formId={formId}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </div>
  );
}
