/**
 * EmissionEstimatesForm
 * Admin form for a facility's Phase 3.7 emission-estimate config —
 * genset energy yield persisted onto the facility's certifier_projects row.
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
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import type { CertifierProjectRow } from "@/data-access/certification";

const isEmissionConfigCertifyField = (field: string) =>
  isCertifyFormField("facilityEmissionConfig", field);

interface EmissionEstimatesFormProps {
  facilityId: string;
  mapping: CertifierProjectRow | null;
}

export function EmissionEstimatesForm({
  facilityId,
  mapping,
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

      <div className="flex flex-col gap-16">
        <SectionLabel>Diesel genset</SectionLabel>
        <FormField
          id="gensetEnergyYieldKwhPerLitre"
          label="Genset energy yield (kWh per litre)"
          certifyRequired={isEmissionConfigCertifyField("gensetEnergyYieldKwhPerLitre")}
          error={errors.gensetEnergyYieldKwhPerLitre?.message}
          helperText="Optional local estimate — genset diesel now submits by volume, so this yield no longer affects submissions (issue #319). Electrical kWh produced per litre of genset diesel; ~3.375 from the Dark Earth LCA (diesel 2.7 kgCO2e/L ÷ genset 0.8 kgCO2e/kWh)."
        >
          <FormInput
            id="gensetEnergyYieldKwhPerLitre"
            type="number"
            step="0.001"
            min={0}
            error={!!errors.gensetEnergyYieldKwhPerLitre}
            {...register("gensetEnergyYieldKwhPerLitre")}
          />
        </FormField>
      </div>

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
