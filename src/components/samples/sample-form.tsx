/**
 * SampleForm component
 * Reusable sample form with React Hook Form integration
 * Uses Base UI Accordion for collapsible form sections
 *
 * Form sections:
 * 1. Sample Info - code, samplingTime, production run
 * 2. Carbon Analysis - totalCarbonPercent, organicCarbonPercent, inorganicCarbonPercent
 * 3. Elemental - H, N, O, S percentages
 * 4. Proximate - ash, volatile matter, moisture
 * 5. Physical - bulkDensity, pH, surfaceArea
 * 6. Stability - hToCOrgRatio (calculated)
 * 7. 1000-Year Durability (conditional) - R₀ reflectance, TGA non-reactive carbon
 */
"use client";

import { numericValue, integerValue } from "@/lib/form-utils";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, EntitySelect } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui";
import { Accordion } from "@/components/ui/accordion";
import {
  sampleFormSchema,
  calculateHToCOrgRatio,
  type SampleFormData,
} from "@/schemas/samples";
import type { SampleWithRelations } from "@/data-access/samples";

// ============================================
// Constants for select options
// ============================================

const durabilityOptions = [
  { value: "200_year", label: "200-Year Durability" },
  { value: "1000_year", label: "1000-Year Durability" },
] as const;

// ============================================
// Component
// ============================================

interface SampleFormProps {
  /** Existing sample data for editing (undefined for create mode) */
  sample?: SampleWithRelations;
  /** Pre-selected production run ID */
  productionRunId?: string;
  /** Form submission handler */
  onSubmit: (data: SampleFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function SampleForm({
  sample,
  productionRunId: preselectedProductionRunId,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: SampleFormProps) {
  const isEditMode = !!sample;

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(sampleFormSchema) as any,
    defaultValues: {
      sampleCode: sample?.sampleCode ?? "",
      productionRunId: preselectedProductionRunId || sample?.productionRunId || "",
      samplingTime: sample?.samplingTime
        ? new Date(sample.samplingTime).toISOString().slice(0, 16)
        : new Date().toISOString().slice(0, 16),
      labName: sample?.labName ?? "",
      labAccreditation: sample?.labAccreditation ?? "",
      analysisDate: sample?.analysisDate
        ? new Date(sample.analysisDate).toISOString().split("T")[0]
        : "",
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
      volatileMatterPercent: sample?.volatileMatterPercent ?? undefined,
      bulkDensityKgPerM3: sample?.bulkDensityKgPerM3 ?? undefined,
      ph: sample?.ph ?? undefined,
      surfaceAreaM2PerG: sample?.surfaceAreaM2PerG ?? undefined,
      saltContentGPerKg: sample?.saltContentGPerKg ?? undefined,
      hToCOrgRatio: sample?.hToCOrgRatio ?? undefined,
      oToCOrgRatio: sample?.oToCOrgRatio ?? undefined,
      durabilityOption: sample?.durabilityOption ?? "200_year",
      randomReflectanceR0Percent: sample?.randomReflectanceR0Percent ?? undefined,
      r0MeasurementCount: sample?.r0MeasurementCount ?? undefined,
      r0AnalysisDate: sample?.r0AnalysisDate
        ? new Date(sample.r0AnalysisDate).toISOString().split("T")[0]
        : "",
      r0HistogramFileUrl: sample?.r0HistogramFileUrl ?? "",
      reactiveCarbonPercent: sample?.reactiveCarbonPercent ?? undefined,
      residualCarbonPercent: sample?.residualCarbonPercent ?? undefined,
      tgaAnalysisDate: sample?.tgaAnalysisDate
        ? new Date(sample.tgaAnalysisDate).toISOString().split("T")[0]
        : "",
      tgaThermogramFileUrl: sample?.tgaThermogramFileUrl ?? "",
      nutrientClaimEnabled: sample?.nutrientClaimEnabled ?? false,
      phosphorusPercent: sample?.phosphorusPercent ?? undefined,
      potassiumPercent: sample?.potassiumPercent ?? undefined,
      magnesiumPercent: sample?.magnesiumPercent ?? undefined,
      calciumPercent: sample?.calciumPercent ?? undefined,
      ironPercent: sample?.ironPercent ?? undefined,
    },
  });

  // Watch fields for calculated values and conditional rendering
  const watchedDurabilityOption = watch("durabilityOption");
  const watchedHydrogenPercent = watch("totalHydrogenPercent");
  const watchedOrganicCarbonPercent = watch("organicCarbonPercent");
  const watchedNutrientClaimEnabled = watch("nutrientClaimEnabled");

  // Derive H:C org ratio from watched values (no useEffect needed)
  const calculatedHToCRatio = calculateHToCOrgRatio(
    watchedHydrogenPercent as number | null,
    watchedOrganicCarbonPercent as number | null
  );

  const defaultSubmitLabel = isEditMode ? "Update Sample" : "Create Sample";

  const handleFormSubmit = handleSubmit((data) => {
    // Inject calculated H:C ratio at submit time
    if (calculatedHToCRatio !== null) {
      data.hToCOrgRatio = parseFloat(calculatedHToCRatio.toFixed(4));
    }
    onSubmit(data as unknown as SampleFormData);
  });

  // Default expanded accordion sections
  const defaultExpandedSections = ["sample-info", "carbon-analysis"];

  return (
    <form onSubmit={handleFormSubmit} className="space-y-32">
      <Accordion.Root defaultValue={defaultExpandedSections}>
        {/* === Section 1: Sample Info === */}
        <Accordion.Item value="sample-info">
          <Accordion.Header>
            <Accordion.Trigger>Sample Information</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            <div className="space-y-24">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-24">
                <FormField
                  id="sampleCode"
                  label="Sample Code"
                  error={errors.sampleCode?.message}
                >
                  <FormInput
                    id="sampleCode"
                    type="text"
                    placeholder="Auto-generated if empty"
                    disabled={isSubmitting}
                    error={!!errors.sampleCode}
                    {...register("sampleCode")}
                  />
                </FormField>

                <FormField
                  id="productionRunId"
                  label="Production Run"
                  error={errors.productionRunId?.message}
                >
                  <Controller
                    name="productionRunId"
                    control={control}
                    render={({ field }) => (
                      <EntitySelect
                        entityType="productionRun"
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Select a production run..."
                        disabled={isSubmitting || !!preselectedProductionRunId}
                        error={!!errors.productionRunId}
                      />
                    )}
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-24">
                <FormField
                  id="samplingTime"
                  label="Sampling Time"
                  error={errors.samplingTime?.message}
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-24">
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-24">
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
            </div>
          </Accordion.Panel>
        </Accordion.Item>

        {/* === Section 2: Carbon Analysis === */}
        <Accordion.Item value="carbon-analysis">
          <Accordion.Header>
            <Accordion.Trigger>Carbon Analysis</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-24">
              <FormField
                id="totalCarbonPercent"
                label="Total Carbon (%)"
                error={errors.totalCarbonPercent?.message}
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
                helperText="C_org for stability calculations"
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
            </div>
          </Accordion.Panel>
        </Accordion.Item>

        {/* === Section 3: Elemental Analysis === */}
        <Accordion.Item value="elemental">
          <Accordion.Header>
            <Accordion.Trigger>Elemental Analysis</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-24">
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
          </Accordion.Panel>
        </Accordion.Item>

        {/* === Section 4: Proximate Analysis === */}
        <Accordion.Item value="proximate">
          <Accordion.Header>
            <Accordion.Trigger>Proximate Analysis</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-24">
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
                id="volatileMatterPercent"
                label="Volatile Matter (%)"
                error={errors.volatileMatterPercent?.message}
              >
                <FormInput
                  id="volatileMatterPercent"
                  type="number"
                  step="0.01"
                  placeholder="e.g., 15.0"
                  disabled={isSubmitting}
                  error={!!errors.volatileMatterPercent}
                  {...register("volatileMatterPercent", {
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
          </Accordion.Panel>
        </Accordion.Item>

        {/* === Section 5: Physical Properties === */}
        <Accordion.Item value="physical">
          <Accordion.Header>
            <Accordion.Trigger>Physical Properties</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-24">
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
                id="surfaceAreaM2PerG"
                label="Surface Area (m²/g)"
                error={errors.surfaceAreaM2PerG?.message}
              >
                <FormInput
                  id="surfaceAreaM2PerG"
                  type="number"
                  step="0.1"
                  placeholder="e.g., 250"
                  disabled={isSubmitting}
                  error={!!errors.surfaceAreaM2PerG}
                  {...register("surfaceAreaM2PerG", {
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
          </Accordion.Panel>
        </Accordion.Item>

        {/* === Section 6: Stability === */}
        <Accordion.Item value="stability">
          <Accordion.Header>
            <Accordion.Trigger>Stability Ratios</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-24">
              <FormField
                id="durabilityOption"
                label="Durability Option"
                error={errors.durabilityOption?.message}
              >
                <FormSelect
                  id="durabilityOption"
                  disabled={isSubmitting}
                  error={!!errors.durabilityOption}
                  options={durabilityOptions}
                  {...register("durabilityOption")}
                />
              </FormField>

              <FormField
                id="hToCOrgRatio"
                label="H:C org Ratio"
                error={errors.hToCOrgRatio?.message}
                helperText="Auto-calculated from H% and C_org%"
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
              >
                <FormInput
                  id="oToCOrgRatio"
                  type="number"
                  step="0.0001"
                  placeholder="e.g., 0.15"
                  disabled={isSubmitting}
                  error={!!errors.oToCOrgRatio}
                  {...register("oToCOrgRatio", {
                    setValueAs: numericValue,
                  })}
                />
              </FormField>
            </div>
          </Accordion.Panel>
        </Accordion.Item>

        {/* === Section 7: 1000-Year Durability (Conditional) === */}
        {watchedDurabilityOption === "1000_year" && (
          <Accordion.Item value="durability-1000">
            <Accordion.Header>
              <Accordion.Trigger>1000-Year Durability Data</Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Panel>
              <div className="space-y-24">
                {/* R₀ Reflectance Section */}
                <div>
                  <h4 className="text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] mb-16">
                    R₀ Reflectance
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-24">
                    <FormField
                      id="randomReflectanceR0Percent"
                      label="Mean Random Reflectance R₀ (%)"
                      error={errors.randomReflectanceR0Percent?.message}
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
                  </div>
                </div>

                {/* TGA Non-Reactive Carbon Section */}
                <div className="pt-24 border-t border-[var(--color-border-tertiary)]">
                  <h4 className="text-[var(--text-s)] font-medium text-[var(--color-text-secondary)] mb-16">
                    TGA Non-Reactive Carbon
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-24">
                    <FormField
                      id="reactiveCarbonPercent"
                      label="Reactive Carbon (%)"
                      error={errors.reactiveCarbonPercent?.message}
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
                  </div>
                </div>
              </div>
            </Accordion.Panel>
          </Accordion.Item>
        )}

        {/* === Nutrient Claims Section === */}
        <Accordion.Item value="nutrients">
          <Accordion.Header>
            <Accordion.Trigger>Nutrient Claims (Optional)</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            <div className="space-y-24">
              <div className="flex items-center gap-16">
                <input
                  type="checkbox"
                  id="nutrientClaimEnabled"
                  className="w-4 h-4 rounded-4 border-[var(--color-border-primary)] text-[var(--clr-dark-purple)] focus:ring-[var(--color-interaction)]"
                  disabled={isSubmitting}
                  {...register("nutrientClaimEnabled")}
                />
                <label
                  htmlFor="nutrientClaimEnabled"
                  className="body-medium text-[var(--color-text-primary)]"
                >
                  Enable nutrient claims
                </label>
              </div>

              {watchedNutrientClaimEnabled && (
                <div className="grid grid-cols-1 md:grid-cols-5 gap-24 pt-24">
                  <FormField
                    id="phosphorusPercent"
                    label="Phosphorus (%)"
                    error={errors.phosphorusPercent?.message}
                  >
                    <FormInput
                      id="phosphorusPercent"
                      type="number"
                      step="0.01"
                      placeholder="e.g., 0.5"
                      disabled={isSubmitting}
                      error={!!errors.phosphorusPercent}
                      {...register("phosphorusPercent", {
                        setValueAs: numericValue,
                      })}
                    />
                  </FormField>

                  <FormField
                    id="potassiumPercent"
                    label="Potassium (%)"
                    error={errors.potassiumPercent?.message}
                  >
                    <FormInput
                      id="potassiumPercent"
                      type="number"
                      step="0.01"
                      placeholder="e.g., 1.2"
                      disabled={isSubmitting}
                      error={!!errors.potassiumPercent}
                      {...register("potassiumPercent", {
                        setValueAs: numericValue,
                      })}
                    />
                  </FormField>

                  <FormField
                    id="magnesiumPercent"
                    label="Magnesium (%)"
                    error={errors.magnesiumPercent?.message}
                  >
                    <FormInput
                      id="magnesiumPercent"
                      type="number"
                      step="0.01"
                      placeholder="e.g., 0.3"
                      disabled={isSubmitting}
                      error={!!errors.magnesiumPercent}
                      {...register("magnesiumPercent", {
                        setValueAs: numericValue,
                      })}
                    />
                  </FormField>

                  <FormField
                    id="calciumPercent"
                    label="Calcium (%)"
                    error={errors.calciumPercent?.message}
                  >
                    <FormInput
                      id="calciumPercent"
                      type="number"
                      step="0.01"
                      placeholder="e.g., 2.0"
                      disabled={isSubmitting}
                      error={!!errors.calciumPercent}
                      {...register("calciumPercent", {
                        setValueAs: numericValue,
                      })}
                    />
                  </FormField>

                  <FormField
                    id="ironPercent"
                    label="Iron (%)"
                    error={errors.ironPercent?.message}
                  >
                    <FormInput
                      id="ironPercent"
                      type="number"
                      step="0.01"
                      placeholder="e.g., 0.1"
                      disabled={isSubmitting}
                      error={!!errors.ironPercent}
                      {...register("ironPercent", {
                        setValueAs: numericValue,
                      })}
                    />
                  </FormField>
                </div>
              )}
            </div>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>

      {/* Form Actions */}
      <div className="flex items-center justify-end gap-16 pt-24 border-t border-[var(--color-border-secondary)]">
        {onCancel && (
          <Button
            type="button"
            variant="default"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : submitLabel ?? defaultSubmitLabel}
        </Button>
      </div>
    </form>
  );
}
