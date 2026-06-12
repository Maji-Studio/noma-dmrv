/**
 * EmissionEstimatesForm
 * Admin form for a facility's Phase 3.7 emission-estimate config —
 * genset energy yield + the process-stage energy split. Persisted onto
 * the facility's certifier_projects row.
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
      stageSplitBiomassPct: mapping?.stageSplitBiomassPct ?? undefined,
      stageSplitPyrolysisPct: mapping?.stageSplitPyrolysisPct ?? undefined,
      stageSplitBiocharPct: mapping?.stageSplitBiocharPct ?? undefined,
      defaultSoilTemperatureC: mapping?.defaultSoilTemperatureC ?? undefined,
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
          required
          certifyRequired={isEmissionConfigCertifyField("gensetEnergyYieldKwhPerLitre")}
          error={errors.gensetEnergyYieldKwhPerLitre?.message}
          helperText="Electrical kWh produced per litre of genset diesel. ~3.375 from the Dark Earth LCA (diesel 2.7 kgCO2e/L ÷ genset 0.8 kgCO2e/kWh)."
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
        <SectionLabel>Soil durability defaults</SectionLabel>
        <FormField
          id="defaultSoilTemperatureC"
          label="Facility fallback soil temperature (°C)"
          error={errors.defaultSoilTemperatureC?.message}
          helperText="Optional conservative fallback for new applications when the selected customer location has no site-specific default."
        >
          <FormInput
            id="defaultSoilTemperatureC"
            type="number"
            step="any"
            error={!!errors.defaultSoilTemperatureC}
            {...register("defaultSoilTemperatureC")}
          />
        </FormField>
      </div>

      <div className="flex flex-col gap-16">
        <SectionLabel>Process-stage energy split (%)</SectionLabel>
        <p className="body-small text-[var(--color-text-secondary)]">
          Estimated share of each run&apos;s combined electricity and genset
          energy across the three stages. Must sum to 100. The split is
          emissions-neutral — it only shapes the per-stage breakdown shown in
          the Isometric registry.
        </p>
        <FormField
          id="stageSplitBiomassPct"
          label="Biomass processing (%)"
          required
          certifyRequired={isEmissionConfigCertifyField("stageSplitBiomassPct")}
          error={errors.stageSplitBiomassPct?.message}
        >
          <FormInput
            id="stageSplitBiomassPct"
            type="number"
            step="0.1"
            min={0}
            max={100}
            error={!!errors.stageSplitBiomassPct}
            {...register("stageSplitBiomassPct")}
          />
        </FormField>
        <FormField
          id="stageSplitPyrolysisPct"
          label="Pyrolysis (%)"
          required
          certifyRequired={isEmissionConfigCertifyField("stageSplitPyrolysisPct")}
          error={errors.stageSplitPyrolysisPct?.message}
        >
          <FormInput
            id="stageSplitPyrolysisPct"
            type="number"
            step="0.1"
            min={0}
            max={100}
            error={!!errors.stageSplitPyrolysisPct}
            {...register("stageSplitPyrolysisPct")}
          />
        </FormField>
        <FormField
          id="stageSplitBiocharPct"
          label="Biochar processing (%)"
          required
          certifyRequired={isEmissionConfigCertifyField("stageSplitBiocharPct")}
          error={errors.stageSplitBiocharPct?.message}
        >
          <FormInput
            id="stageSplitBiocharPct"
            type="number"
            step="0.1"
            min={0}
            max={100}
            error={!!errors.stageSplitBiocharPct}
            {...register("stageSplitBiocharPct")}
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
