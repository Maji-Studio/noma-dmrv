/**
 * SampleForm component
 * Reusable sample form with React Hook Form integration
 *
 * Flat labeled sections (the production-run form grammar — mono section
 * labels + hairline dividers, no accordions). A sample anchors on ONE credit
 * batch (issue #309); the batch's declared durability tier is inherited, never
 * selected here — progressive disclosure only where the data demands it: the
 * 1000-year sections appear when the batch is 1000-year, nutrient fields with
 * the claim checkbox.
 *
 * Spine steps (Evidence & Transport sit OUTSIDE the `<form>` element — they
 * nest their own forms — but FormSpine numbers them on the same rail):
 * 1. Sample Info - credit batch, samplingTime, lab details
 * 2. Carbon Analysis - totalCarbonPercent, organicCarbonPercent, inorganicCarbonPercent
 * 3. Elemental - H, N, O, S percentages
 * 4. Proximate - ash, moisture
 * 5. Physical - bulkDensity, pH, saltContent
 * 6. Stability - H:C ratio, O:C ratio (durability tier shown, from the batch)
 * (+2 conditional, 1000-year batches) R₀ reflectance · TGA non-reactive carbon
 * 7. Nutrient Claims (conditional) - P, K, Mg, Ca, Fe
 * 8. Evidence & Documents
 * 9. Transport (lab shipment legs)
 */
"use client";

import { numericValue, integerValue } from "@/lib/form-utils";
import { formatLocalDateTime } from "@/lib/date-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { useBatchDurabilitySummary } from "@/hooks/use-certification";

import { useEffect, useId } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FlaskIcon, FireIcon, AtomIcon, ScalesIcon, CubeIcon, CalculatorIcon, EyeIcon, ThermometerIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, EntitySelect, FormActions, FormSection, FormSpine, makeCertFieldStatus } from "@/components/forms";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import {
  sampleFormSchema,
  calculateHToCOrgRatio,
  calculateOToCOrgRatio,
  formatDurabilityOption,
  type SampleFormData,
} from "@/schemas/samples";
import { SampleEligibilityAdvisory } from "./sample-eligibility-advisory";
import { SampleBatchProgress } from "./sample-batch-progress";
import { SampleNutrientFields } from "./sample-nutrient-fields";
import {
  SampleEvidenceSection,
  SampleTransportSection,
} from "./sample-trailing-sections";
import type { SampleWithRelations } from "@/data-access/samples";
import type { UseDeferredAttachmentsResult } from "@/hooks/use-deferred-attachments";
import type { TransportLegFormData } from "@/schemas/transport-legs";

// ============================================
// Constants
// ============================================

const NO_FACILITY_SENTINEL = "__none__";

const isSampleCertifyField = (field: string) =>
  isCertifyFormField("sample", field);

// ============================================
// Component
// ============================================

interface SampleFormProps {
  /** Existing sample data for editing (undefined for create mode) */
  sample?: SampleWithRelations;
  /** Pre-selected credit batch ID (e.g. from a batch detail deep link) */
  creditBatchId?: string;
  /** Form submission handler */
  onSubmit: (data: SampleFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
  deferredAttachments?: UseDeferredAttachmentsResult;
  deferredLegs?: TransportLegFormData[];
  onDeferredLegsChange?: (legs: TransportLegFormData[]) => void;
  onRetryDeferredLegs?: () => Promise<void>;
}

export function SampleForm({
  sample,
  creditBatchId: preselectedCreditBatchId,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  deferredAttachments,
  deferredLegs,
  onDeferredLegsChange,
  onRetryDeferredLegs,
}: SampleFormProps) {
  const formId = useId();
  const isEditMode = !!sample;
  const { facilityId: contextFacilityId } = useFacilityContext();

  const defaultValues = {
      creditBatchId: preselectedCreditBatchId || sample?.creditBatchId || "",
      samplingTime: sample?.samplingTime
        ? formatLocalDateTime(new Date(sample.samplingTime))
        : formatLocalDateTime(new Date()),
      labName: sample?.labName ?? "",
      labAccreditation: sample?.labAccreditation ?? "",
      analysisDate: sample?.analysisDate ?? "",
      weightGrams: sample?.weightGrams ?? undefined,
      volumeMl: sample?.volumeMl ?? undefined,
      totalCarbonPercent: sample?.totalCarbonPercent ?? undefined,
      organicCarbonPercent: sample?.organicCarbonPercent ?? undefined,
      inorganicCarbonPercent: sample?.inorganicCarbonPercent ?? undefined,
      totalHydrogenPercent: sample?.totalHydrogenPercent ?? undefined,
      totalNitrogenPercent: sample?.totalNitrogenPercent ?? undefined,
      totalOxygenPercent: sample?.totalOxygenPercent ?? undefined,
      totalSulfurPercent: sample?.totalSulfurPercent ?? undefined,
      ashContentPercent: sample?.ashContentPercent ?? undefined,
      moistureContentPercent: sample?.moistureContentPercent ?? undefined,
      bulkDensityKgPerM3: sample?.bulkDensityKgPerM3 ?? undefined,
      ph: sample?.ph ?? undefined,
      saltContentGPerKg: sample?.saltContentGPerKg ?? undefined,
      hToCOrgRatio: sample?.hToCOrgRatio ?? undefined,
      oToCOrgRatio: sample?.oToCOrgRatio ?? undefined,
      durabilityOption: sample?.durabilityOption ?? "200_year",
      randomReflectanceR0Percent: sample?.randomReflectanceR0Percent ?? undefined,
      sReflectanceFraction: sample?.sReflectanceFraction ?? undefined,
      r0MeasurementCount: sample?.r0MeasurementCount ?? undefined,
      r0AnalysisDate: sample?.r0AnalysisDate ?? "",
      r0HistogramFileUrl: sample?.r0HistogramFileUrl ?? "",
      reactiveCarbonPercent: sample?.reactiveCarbonPercent ?? undefined,
      residualCarbonPercent: sample?.residualCarbonPercent ?? undefined,
      tgaAnalysisDate: sample?.tgaAnalysisDate ?? "",
      tgaThermogramFileUrl: sample?.tgaThermogramFileUrl ?? "",
      nutrientClaimEnabled: sample?.nutrientClaimEnabled ?? false,
      phosphorusPercent: sample?.phosphorusPercent ?? undefined,
      potassiumPercent: sample?.potassiumPercent ?? undefined,
      magnesiumPercent: sample?.magnesiumPercent ?? undefined,
      calciumPercent: sample?.calciumPercent ?? undefined,
      ironPercent: sample?.ironPercent ?? undefined,
  };

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(sampleFormSchema) as any,
    // onTouched so spine markers can flag errors on blur, not only on submit.
    mode: "onTouched",
    defaultValues,
  });

  // CERT chips reflect the saved record (frozen), neutral while creating.
  const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);

  // Watch fields for calculated values and conditional rendering
  const watchedCreditBatchId = watch("creditBatchId");
  const watchedDurabilityOption = watch("durabilityOption");
  const watchedHydrogenPercent = watch("totalHydrogenPercent");
  const watchedOxygenPercent = watch("totalOxygenPercent");
  const watchedOrganicCarbonPercent = watch("organicCarbonPercent");
  const watchedOToCOrgRatio = watch("oToCOrgRatio");
  const watchedNutrientClaimEnabled = watch("nutrientClaimEnabled");

  // The durability tier is NOT selected on the sample — it's the credit batch's
  // declared tier (issue #309). Sync it into form state from the batch summary
  // (the same query the progress panel below reads) so the conditional
  // 1000-year sections and their validation follow the chosen batch.
  const { data: batchSummary } = useBatchDurabilitySummary(
    watchedCreditBatchId || "",
    !!watchedCreditBatchId,
  );
  const batchDurabilityOption = batchSummary?.durabilityOption;
  useEffect(() => {
    if (batchDurabilityOption) {
      setValue("durabilityOption", batchDurabilityOption);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchDurabilityOption]);

  // Clear 1000-year fields when switching to 200-year
  useEffect(() => {
    if (watchedDurabilityOption === "200_year") {
      setValue("randomReflectanceR0Percent", undefined);
      setValue("sReflectanceFraction", undefined);
      setValue("r0MeasurementCount", undefined);
      setValue("r0AnalysisDate", "");
      setValue("r0HistogramFileUrl", "");
      setValue("reactiveCarbonPercent", undefined);
      setValue("residualCarbonPercent", undefined);
      setValue("tgaAnalysisDate", "");
      setValue("tgaThermogramFileUrl", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedDurabilityOption]);

  // Clear nutrient fields when nutrient claims disabled
  useEffect(() => {
    if (!watchedNutrientClaimEnabled) {
      setValue("phosphorusPercent", undefined);
      setValue("potassiumPercent", undefined);
      setValue("magnesiumPercent", undefined);
      setValue("calciumPercent", undefined);
      setValue("ironPercent", undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedNutrientClaimEnabled]);

  // Derive H:C org ratio from watched values (no useEffect needed)
  const calculatedHToCRatio = calculateHToCOrgRatio(
    watchedHydrogenPercent as number | null,
    watchedOrganicCarbonPercent as number | null
  );

  // Derive O:C org from O% and C_org% so the universal eligibility gate
  // (O/C_org < 0.2) survives when the manual O:Corg input is left blank —
  // relevant under 1000-year where the ratios sit behind a collapsed
  // disclosure. A manually-entered O:Corg still wins.
  const calculatedOToCRatio = calculateOToCOrgRatio(
    watchedOxygenPercent as number | null,
    watchedOrganicCarbonPercent as number | null
  );
  const resolvedOToCRatio =
    (watchedOToCOrgRatio as number | null | undefined) ?? calculatedOToCRatio;

  const is1000Year = watchedDurabilityOption === "1000_year";

  // The H:Corg / O:Corg input pair. Rendered inline under 200-year (H:Corg
  // drives durability) and inside an optional disclosure under 1000-year.
  const stabilityRatioFields = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
      <FormField
        id="hToCOrgRatio"
        label="H:C org Ratio"
        error={errors.hToCOrgRatio?.message}
        helperText="Auto-calculated from H% and C_org%"
        certifyRequired={isSampleCertifyField("hToCOrgRatio")}
        certifyStatus={certStatus("hToCOrgRatio")}
      >
        <FormInput
          id="hToCOrgRatio"
          type="number"
          step="0.0001"
          placeholder="Auto-calculated"
          disabled
          readOnly
          value={calculatedHToCRatio !== null ? calculatedHToCRatio.toFixed(4) : ""}
          error={!!errors.hToCOrgRatio}
        />
      </FormField>

      <FormField
        id="oToCOrgRatio"
        label="O:C org Ratio"
        error={errors.oToCOrgRatio?.message}
        helperText="Enter to override, or leave blank to derive from O% and C_org%"
      >
        <FormInput
          id="oToCOrgRatio"
          type="number"
          step="0.0001"
          placeholder={
            calculatedOToCRatio !== null
              ? calculatedOToCRatio.toFixed(4)
              : "e.g., 0.15"
          }
          disabled={isSubmitting}
          error={!!errors.oToCOrgRatio}
          {...register("oToCOrgRatio", {
            setValueAs: numericValue,
          })}
        />
      </FormField>
    </div>
  );

  const defaultSubmitLabel = isEditMode ? "Update Sample" : "Create Sample";

  const handleFormSubmit = handleSubmit((data) => {
    // Inject calculated H:C ratio at submit time
    if (calculatedHToCRatio !== null) {
      data.hToCOrgRatio = parseFloat(calculatedHToCRatio.toFixed(4));
    }
    // Fall back to the derived O:Corg when no manual value was entered, so the
    // O/C_org eligibility gate has an input even under 1000-year.
    if (data.oToCOrgRatio == null && calculatedOToCRatio !== null) {
      data.oToCOrgRatio = parseFloat(calculatedOToCRatio.toFixed(4));
    }
    onSubmit(data as unknown as SampleFormData);
  });

  return (
    <div className="space-y-20">
      {/* The spine wraps the <form> AND the trailing field-less steps (Evidence,
          Transport) that must live outside it — one continuous numbered rail. */}
      <FormSpine control={control}>
      <form id={formId} onSubmit={handleFormSubmit}>
        {/* ── Sample Information ── */}
        <FormSection
          title="Sample Information"
          icon={<FlaskIcon size={14} weight="bold" />}
          fields={["creditBatchId", "samplingTime", "analysisDate", "labName", "labAccreditation", "weightGrams", "volumeMl"]}
        >
              <FormField
                id="creditBatchId"
                label="Credit Batch"
                error={errors.creditBatchId?.message}
                required
              >
                <Controller
                  name="creditBatchId"
                  control={control}
                  render={({ field }) => (
                    <EntitySelect
                      entityType="creditBatch"
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={contextFacilityId ? "Select a credit batch..." : "Select a facility first"}
                      disabled={isSubmitting || !!preselectedCreditBatchId || !contextFacilityId}
                      error={!!errors.creditBatchId}
                      filterBy={{ facilityId: contextFacilityId ?? NO_FACILITY_SENTINEL }}
                      autoSelectSingle
                    />
                  )}
                />
              </FormField>

              {/* Live ≥3 sampling progress for the chosen batch (ADR 0016) */}
              <SampleBatchProgress creditBatchId={watchedCreditBatchId} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
                <FormField
                  id="samplingTime"
                  label="Sampling Time"
                  error={errors.samplingTime?.message}
                  required
                >
                  <FormInput
                    id="samplingTime"
                    type="datetime-local"
                    disabled={isSubmitting}
                    error={!!errors.samplingTime}
                    {...register("samplingTime", {
                      setValueAs: (v) => (v ? new Date(v) : undefined),
                    })}
                  />
                </FormField>

                <FormField
                  id="analysisDate"
                  label="Analysis Date"
                  error={errors.analysisDate?.message}
                >
                  <FormInput
                    id="analysisDate"
                    type="date"
                    disabled={isSubmitting}
                    error={!!errors.analysisDate}
                    {...register("analysisDate", {
                      setValueAs: (v) => (v ? new Date(v) : null),
                    })}
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
                <FormField
                  id="labName"
                  label="Lab Name"
                  error={errors.labName?.message}
                >
                  <FormInput
                    id="labName"
                    type="text"
                    placeholder="e.g., SGS Laboratories"
                    disabled={isSubmitting}
                    error={!!errors.labName}
                    {...register("labName")}
                  />
                </FormField>

                <FormField
                  id="labAccreditation"
                  label="Lab Accreditation"
                  error={errors.labAccreditation?.message}
                >
                  <FormInput
                    id="labAccreditation"
                    type="text"
                    placeholder="e.g., ISO 17025"
                    disabled={isSubmitting}
                    error={!!errors.labAccreditation}
                    {...register("labAccreditation")}
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
                <FormField
                  id="weightGrams"
                  label="Sample Weight (g)"
                  error={errors.weightGrams?.message}
                >
                  <FormInput
                    id="weightGrams"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 50"
                    disabled={isSubmitting}
                    error={!!errors.weightGrams}
                    {...register("weightGrams", {
                      setValueAs: numericValue,
                    })}
                  />
                </FormField>

                <FormField
                  id="volumeMl"
                  label="Sample Volume (mL)"
                  error={errors.volumeMl?.message}
                >
                  <FormInput
                    id="volumeMl"
                    type="number"
                    step="0.1"
                    placeholder="e.g., 100"
                    disabled={isSubmitting}
                    error={!!errors.volumeMl}
                    {...register("volumeMl", {
                      setValueAs: numericValue,
                    })}
                  />
                </FormField>
              </div>
        </FormSection>

        {/* ── Carbon Analysis ── */}
        <FormSection
          title="Carbon Analysis"
          icon={<FireIcon size={14} weight="bold" />}
          fields={["totalCarbonPercent", "organicCarbonPercent", "inorganicCarbonPercent"]}
        >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
                <FormField
                  id="totalCarbonPercent"
                  label="Total Carbon (%)"
                  error={errors.totalCarbonPercent?.message}
                  required
                >
                  <FormInput
                    id="totalCarbonPercent"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 75.5"
                    disabled={isSubmitting}
                    error={!!errors.totalCarbonPercent}
                    {...register("totalCarbonPercent", {
                      setValueAs: numericValue,
                    })}
                  />
                </FormField>

                <FormField
                  id="organicCarbonPercent"
                  label="Organic Carbon (%)"
                  error={errors.organicCarbonPercent?.message}
                  helperText="Basis for the H:Corg / O:Corg eligibility ratios and durable-carbon accounting (both tiers)."
                  required
                  certifyRequired={isSampleCertifyField("organicCarbonPercent")}
                  certifyStatus={certStatus("organicCarbonPercent")}
                >
                  <FormInput
                    id="organicCarbonPercent"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 72.0"
                    disabled={isSubmitting}
                    error={!!errors.organicCarbonPercent}
                    {...register("organicCarbonPercent", {
                      setValueAs: numericValue,
                    })}
                  />
                </FormField>
              </div>

              <FormField
                id="inorganicCarbonPercent"
                label="Inorganic Carbon (%)"
                error={errors.inorganicCarbonPercent?.message}
              >
                <FormInput
                  id="inorganicCarbonPercent"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 3.5"
                  disabled={isSubmitting}
                  error={!!errors.inorganicCarbonPercent}
                  {...register("inorganicCarbonPercent", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>
        </FormSection>

        {/* ── Elemental Analysis ── */}
        <FormSection
          title="Elemental Analysis"
          icon={<AtomIcon size={14} weight="bold" />}
          fields={["totalHydrogenPercent", "totalNitrogenPercent", "totalOxygenPercent", "totalSulfurPercent"]}
        >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
              <FormField
                id="totalHydrogenPercent"
                label="Hydrogen (%)"
                error={errors.totalHydrogenPercent?.message}
              >
                <FormInput
                  id="totalHydrogenPercent"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 2.5"
                  disabled={isSubmitting}
                  error={!!errors.totalHydrogenPercent}
                  {...register("totalHydrogenPercent", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>

              <FormField
                id="totalNitrogenPercent"
                label="Nitrogen (%)"
                error={errors.totalNitrogenPercent?.message}
              >
                <FormInput
                  id="totalNitrogenPercent"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 0.8"
                  disabled={isSubmitting}
                  error={!!errors.totalNitrogenPercent}
                  {...register("totalNitrogenPercent", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>

              <FormField
                id="totalOxygenPercent"
                label="Oxygen (%)"
                error={errors.totalOxygenPercent?.message}
              >
                <FormInput
                  id="totalOxygenPercent"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 12.0"
                  disabled={isSubmitting}
                  error={!!errors.totalOxygenPercent}
                  {...register("totalOxygenPercent", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>

              <FormField
                id="totalSulfurPercent"
                label="Sulfur (%)"
                error={errors.totalSulfurPercent?.message}
              >
                <FormInput
                  id="totalSulfurPercent"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 0.1"
                  disabled={isSubmitting}
                  error={!!errors.totalSulfurPercent}
                  {...register("totalSulfurPercent", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>
            </div>
        </FormSection>

        {/* ── Proximate Analysis ── */}
        <FormSection
          title="Proximate Analysis"
          icon={<ScalesIcon size={14} weight="bold" />}
          fields={["ashContentPercent", "moistureContentPercent"]}
        >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
                <FormField
                  id="ashContentPercent"
                  label="Ash Content (%)"
                  error={errors.ashContentPercent?.message}
                >
                  <FormInput
                    id="ashContentPercent"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 8.5"
                    disabled={isSubmitting}
                    error={!!errors.ashContentPercent}
                    {...register("ashContentPercent", {
                      setValueAs: numericValue,
                    })}
                  />
                </FormField>

                <FormField
                  id="moistureContentPercent"
                  label="Moisture Content (%)"
                  error={errors.moistureContentPercent?.message}
                >
                  <FormInput
                    id="moistureContentPercent"
                    type="number"
                    step="0.01"
                    placeholder="e.g., 5.0"
                    disabled={isSubmitting}
                    error={!!errors.moistureContentPercent}
                    {...register("moistureContentPercent", {
                      setValueAs: numericValue,
                    })}
                  />
                </FormField>
              </div>
        </FormSection>

        {/* ── Physical Properties ── */}
        <FormSection
          title="Physical Properties"
          icon={<CubeIcon size={14} weight="bold" />}
          fields={["bulkDensityKgPerM3", "ph", "saltContentGPerKg"]}
        >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
              <FormField
                id="bulkDensityKgPerM3"
                label="Bulk Density (kg/m³)"
                error={errors.bulkDensityKgPerM3?.message}
              >
                <FormInput
                  id="bulkDensityKgPerM3"
                  type="number"
                  step="0.1"
                  placeholder="e.g., 350"
                  disabled={isSubmitting}
                  error={!!errors.bulkDensityKgPerM3}
                  {...register("bulkDensityKgPerM3", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>

              <FormField
                id="ph"
                label="pH"
                error={errors.ph?.message}
              >
                <FormInput
                  id="ph"
                  type="number"
                  step="0.1"
                  min="0"
                  max="14"
                  placeholder="e.g., 9.5"
                  disabled={isSubmitting}
                  error={!!errors.ph}
                  {...register("ph", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>

              <FormField
                id="saltContentGPerKg"
                label="Salt Content (g/kg)"
                error={errors.saltContentGPerKg?.message}
              >
                <FormInput
                  id="saltContentGPerKg"
                  type="number"
                  step="0.1"
                  placeholder="e.g., 5.0"
                  disabled={isSubmitting}
                  error={!!errors.saltContentGPerKg}
                  {...register("saltContentGPerKg", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>
            </div>
        </FormSection>

        {/* ── Stability Ratios ── */}
        <FormSection
          title="Stability Ratios"
          icon={<CalculatorIcon size={14} weight="bold" />}
          fields={["hToCOrgRatio", "oToCOrgRatio"]}
        >
              {/* The durability tier is the credit batch's declared choice —
                  shown here (it decides which analyses follow), never edited. */}
              <p className="body-caption text-[var(--color-text-secondary)]">
                {watchedCreditBatchId
                  ? `${formatDurabilityOption(watchedDurabilityOption)} durability — inherited from the selected credit batch.`
                  : "The durability tier is inherited from the selected credit batch."}
              </p>

              {/* Under 1000-year, durability is measured by R₀ + TGA (below), so
                  the H:Corg/O:Corg ratios move behind an optional disclosure —
                  they're kept only for the universal eligibility gate
                  (H/C_org < 0.5, O/C_org < 0.2), not the durability estimate.
                  Under 200-year they stay in view (H:Corg drives durability). */}
              {is1000Year ? (
                <details className="border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)]">
                  <summary className="cursor-pointer px-12 py-8 body-small font-medium text-[var(--color-text-primary)] marker:text-[var(--color-text-tertiary)]">
                    Eligibility ratios (H:Corg, O:Corg) — optional
                  </summary>
                  <div className="flex flex-col gap-16 border-t border-[var(--color-border-tertiary)] p-12">
                    <p className="body-caption text-[var(--color-text-tertiary)]">
                      Not used for the 1000-year durability estimate. Kept for the
                      universal eligibility check (H/C_org &lt; 0.5, O/C_org &lt;
                      0.2). H:Corg auto-calculates from H% and C_org%; O:Corg
                      derives from O% and C_org% unless you enter it.
                    </p>
                    {stabilityRatioFields}
                  </div>
                </details>
              ) : (
                stabilityRatioFields
              )}

              <SampleEligibilityAdvisory
                hToCOrgRatio={calculatedHToCRatio}
                oToCOrgRatio={resolvedOToCRatio}
              />
        </FormSection>

        {/* ── 1000-Year Durability (conditional, two flat sibling sections) ── */}
        {watchedDurabilityOption === "1000_year" && (
          <>
            <FormSection
              title="1000-Year Durability · R₀ Reflectance"
              icon={<EyeIcon size={14} weight="bold" />}
              fields={["randomReflectanceR0Percent", "sReflectanceFraction", "r0MeasurementCount", "r0AnalysisDate"]}
            >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
                  <FormField
                    id="randomReflectanceR0Percent"
                    label="Mean Random Reflectance R₀ (%)"
                    error={errors.randomReflectanceR0Percent?.message}
                    certifyRequired={isSampleCertifyField("randomReflectanceR0Percent")}
                    certifyStatus={certStatus("randomReflectanceR0Percent")}
                  >
                    <FormInput
                      id="randomReflectanceR0Percent"
                      type="number"
                      step="0.01"
                      placeholder="e.g., 2.5"
                      disabled={isSubmitting}
                      error={!!errors.randomReflectanceR0Percent}
                      {...register("randomReflectanceR0Percent", {
                        setValueAs: numericValue,
                      })}
                    />
                  </FormField>

                  <FormField
                    id="sReflectanceFraction"
                    label="R₀ Readings at or above 2% (%)"
                    helperText="Share of ISO 7404-5 reflectance readings meeting the 1000-year threshold."
                    error={errors.sReflectanceFraction?.message}
                    certifyRequired={isSampleCertifyField("sReflectanceFraction")}
                    certifyStatus={certStatus("sReflectanceFraction")}
                  >
                    <Controller
                      name="sReflectanceFraction"
                      control={control}
                      render={({ field }) => (
                        <FormInput
                          id="sReflectanceFraction"
                          name={field.name}
                          ref={field.ref}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          placeholder="e.g., 92"
                          disabled={isSubmitting}
                          error={!!errors.sReflectanceFraction}
                          value={typeof field.value === "number" ? field.value * 100 : ""}
                          onBlur={field.onBlur}
                          onChange={(event) => {
                            const percentage = numericValue(event.target.value);
                            field.onChange(percentage == null ? percentage : percentage / 100);
                          }}
                        />
                      )}
                    />
                  </FormField>

                  <FormField
                    id="r0MeasurementCount"
                    label="Measurement Count"
                    error={errors.r0MeasurementCount?.message}
                  >
                    <FormInput
                      id="r0MeasurementCount"
                      type="number"
                      step="1"
                      min="0"
                      placeholder="e.g., 100"
                      disabled={isSubmitting}
                      error={!!errors.r0MeasurementCount}
                      {...register("r0MeasurementCount", {
                        setValueAs: integerValue,
                      })}
                    />
                  </FormField>
                </div>

                <FormField
                  id="r0AnalysisDate"
                  label="R₀ Analysis Date"
                  error={errors.r0AnalysisDate?.message}
                >
                  <FormInput
                    id="r0AnalysisDate"
                    type="date"
                    disabled={isSubmitting}
                    error={!!errors.r0AnalysisDate}
                    {...register("r0AnalysisDate", {
                      setValueAs: (v) => (v ? new Date(v) : null),
                    })}
                  />
                </FormField>
            </FormSection>

            <FormSection
              title="TGA Non-Reactive Carbon"
              icon={<ThermometerIcon size={14} weight="bold" />}
              fields={["reactiveCarbonPercent", "residualCarbonPercent", "tgaAnalysisDate"]}
            >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
                  <FormField
                    id="reactiveCarbonPercent"
                    label="Reactive Carbon (%)"
                    error={errors.reactiveCarbonPercent?.message}
                    certifyRequired={isSampleCertifyField("reactiveCarbonPercent")}
                    certifyStatus={certStatus("reactiveCarbonPercent")}
                  >
                    <FormInput
                      id="reactiveCarbonPercent"
                      type="number"
                      step="0.01"
                      placeholder="e.g., 15.0"
                      disabled={isSubmitting}
                      error={!!errors.reactiveCarbonPercent}
                      {...register("reactiveCarbonPercent", {
                        setValueAs: numericValue,
                      })}
                    />
                  </FormField>

                  <FormField
                    id="residualCarbonPercent"
                    label="Residual (Non-Reactive) Carbon (%)"
                    error={errors.residualCarbonPercent?.message}
                    certifyRequired={isSampleCertifyField("residualCarbonPercent")}
                    certifyStatus={certStatus("residualCarbonPercent")}
                  >
                    <FormInput
                      id="residualCarbonPercent"
                      type="number"
                      step="0.01"
                      placeholder="e.g., 85.0"
                      disabled={isSubmitting}
                      error={!!errors.residualCarbonPercent}
                      {...register("residualCarbonPercent", {
                        setValueAs: numericValue,
                      })}
                    />
                  </FormField>
                </div>

                <FormField
                  id="tgaAnalysisDate"
                  label="TGA Analysis Date"
                  error={errors.tgaAnalysisDate?.message}
                >
                  <FormInput
                    id="tgaAnalysisDate"
                    type="date"
                    disabled={isSubmitting}
                    error={!!errors.tgaAnalysisDate}
                    {...register("tgaAnalysisDate", {
                      setValueAs: (v) => (v ? new Date(v) : null),
                    })}
                  />
                </FormField>
            </FormSection>
          </>
        )}

        <SampleNutrientFields
          enabled={watchedNutrientClaimEnabled}
          isSubmitting={isSubmitting}
          enabledRegistration={register("nutrientClaimEnabled")}
          phosphorus={{ registration: register("phosphorusPercent", { setValueAs: numericValue }), error: errors.phosphorusPercent?.message }}
          potassium={{ registration: register("potassiumPercent", { setValueAs: numericValue }), error: errors.potassiumPercent?.message }}
          magnesium={{ registration: register("magnesiumPercent", { setValueAs: numericValue }), error: errors.magnesiumPercent?.message }}
          calcium={{ registration: register("calciumPercent", { setValueAs: numericValue }), error: errors.calciumPercent?.message }}
          iron={{ registration: register("ironPercent", { setValueAs: numericValue }), error: errors.ironPercent?.message }}
        />

      </form>

      {/* ── Trailing field-less steps — outside the <form> (their editors nest
             their own forms), numbered by the spine as the final two steps. ── */}
      <SampleEvidenceSection
        sample={sample}
        isEditMode={isEditMode}
        deferredAttachments={deferredAttachments}
        isSubmitting={isSubmitting}
      />
      <SampleTransportSection
        sample={sample}
        isEditMode={isEditMode}
        deferredLegs={deferredLegs}
        onDeferredLegsChange={onDeferredLegsChange}
        onRetryLegs={onRetryDeferredLegs}
        isSubmitting={isSubmitting}
      />
      </FormSpine>

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
