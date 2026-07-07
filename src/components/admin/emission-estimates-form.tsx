/**
 * EmissionEstimatesForm
 * Admin form for a facility's emission-estimate config on the certifier_projects
 * row. The only user-facing input is the reference soil temperature, which is a
 * 200-year-only durability input — so the form renders fields only for 200-year
 * facilities and an explanatory note for 1000-year ones (ADR 0021). Genset
 * energy yield is round-tripped as a hidden field: issue #319 made it vestigial
 * (diesel submits by volume) but the stored value is preserved without a
 * migration.
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui";
import {
  FormField,
  FormInput,
  SectionLabel,
  ServerError,
} from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import {
  SOIL_TEMPERATURE_SOURCE_MAX_LENGTH,
  facilityEmissionConfigSchema,
  type FacilityEmissionConfigFormData,
} from "@/schemas/certification";
import { useSaveFacilityEmissionConfig } from "@/hooks/use-certification";
import type { CertifierProjectRow } from "@/data-access/certification";

interface EmissionEstimatesFormProps {
  facilityId: string;
  mapping: CertifierProjectRow | null;
  /**
   * Facility durability tier (ADR 0021). Reference soil temperature is an input
   * ONLY to the 200-year durable fraction — 1000-year batches derive it from
   * petrographic reflectance (R₀) — so the soil section renders only for
   * 200-year facilities.
   */
  durabilityOption: "200_year" | "1000_year";
}

export function EmissionEstimatesForm({
  facilityId,
  mapping,
  durabilityOption,
}: EmissionEstimatesFormProps) {
  const toast = useToast();
  const saveMutation = useSaveFacilityEmissionConfig();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(facilityEmissionConfigSchema),
    defaultValues: {
      facilityId,
      gensetEnergyYieldKwhPerLitre:
        mapping?.gensetEnergyYieldKwhPerLitre ?? undefined,
      defaultSoilTemperatureC: mapping?.defaultSoilTemperatureC ?? undefined,
      defaultSoilTemperatureSource:
        mapping?.defaultSoilTemperatureSource ?? undefined,
    },
  });

  if (!mapping) {
    return (
      <p className="body-medium text-[var(--color-text-secondary)]">
        This facility isn&apos;t linked to an Isometric project yet. Link it
        from the facility settings before configuring emission estimates.
      </p>
    );
  }

  // Reference soil temperature is a 200-year-only input. A 1000-year facility
  // has nothing to configure here — genset diesel submits by volume (#319) and
  // the durable fraction comes from petrographic reflectance, not soil temp.
  const showSoilReference = durabilityOption === "200_year";
  if (!showSoilReference) {
    return (
      <p className="body-medium text-[var(--color-text-secondary)]">
        No emission estimates to configure for 1000-year durability. Genset
        diesel submits by volume, and reference soil temperature applies only to
        200-year removals.
      </p>
    );
  }

  const onSubmit = async (raw: unknown) => {
    try {
      await saveMutation.mutateAsync(raw as FacilityEmissionConfigFormData);
      toast.success("Emission estimates saved");
    } catch (error) {
      setError("root.serverError", {
        type: "server",
        message:
          error instanceof Error ? error.message : "Failed to save estimates",
      });
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-32 max-w-[560px]"
    >
      {errors.root?.serverError?.message && (
        <ServerError message={errors.root.serverError.message} />
      )}
      <input type="hidden" {...register("facilityId")} />
      {/* Genset energy yield is no longer user-configurable: issue #319 switched
          genset diesel to submit by volume (`fuel_usage_by_volume`), so the
          kWh-per-litre yield feeds no submission. Round-tripped as a hidden
          field so saving soil estimates preserves the stored value without a
          migration to drop the column. */}
      <input type="hidden" {...register("gensetEnergyYieldKwhPerLitre")} />

      <div className="flex flex-col gap-16">
        <SectionLabel>Soil durability reference</SectionLabel>
        <FormField
          id="defaultSoilTemperatureC"
          label="Reference soil temperature (°C)"
          error={errors.defaultSoilTemperatureC?.message}
          helperText="Annual-average soil temperature submitted to the registry for 200-year durability. Source it from an approved global dataset (e.g. Lembrechts 2022 SoilTemp) — air temperature is not allowed. A 200-year removal cannot be submitted until this is set; values below 7 °C are floored to 7 °C."
        >
          <FormInput
            id="defaultSoilTemperatureC"
            type="number"
            step="any"
            error={!!errors.defaultSoilTemperatureC}
            {...register("defaultSoilTemperatureC")}
          />
        </FormField>
        <FormField
          id="defaultSoilTemperatureSource"
          label="Reference dataset / region note"
          error={errors.defaultSoilTemperatureSource?.message}
          helperText="Dataset, depth, and region for the PDD audit trail (e.g. “Lembrechts et al. 2022 SoilTemp, 0–5 cm, <region>”). Recorded with the submission; not sent on the wire."
        >
          <FormInput
            id="defaultSoilTemperatureSource"
            type="text"
            maxLength={SOIL_TEMPERATURE_SOURCE_MAX_LENGTH}
            error={!!errors.defaultSoilTemperatureSource}
            {...register("defaultSoilTemperatureSource")}
          />
        </FormField>
      </div>

      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={isSubmitting || saveMutation.isPending}
        >
          {isSubmitting || saveMutation.isPending
            ? "Saving..."
            : "Save estimates"}
        </Button>
      </div>
    </form>
  );
}
