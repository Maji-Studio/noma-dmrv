/**
 * EmissionEstimatesForm
 * Admin form for a facility's emission-estimate config on the certifier_projects
 * row. The only user-facing input is the reference soil temperature, which is a
 * 200-year-only durability input — so the form renders fields only for 200-year
 * facilities and an explanatory note for 1000-year ones (ADR 0021).
 */
"use client";

import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import { makeCertFieldStatus } from "@/components/forms/cert-field-status";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui";
import {
  FormActions,
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

/** Inputs hold strings, so a baseline must too or retyping a saved value reads dirty. */
function toInputValues(
  facilityId: string,
  temperature: number | null | undefined,
  source: string | null | undefined,
) {
  return {
    facilityId,
    defaultSoilTemperatureC: temperature == null ? "" : String(temperature),
    defaultSoilTemperatureSource: source ?? "",
  };
}

export function EmissionEstimatesForm({
  facilityId,
  mapping,
  durabilityOption,
}: EmissionEstimatesFormProps) {
  const certStatus = makeCertFieldStatus(mapping ?? undefined);
  const toast = useToast();
  const saveMutation = useSaveFacilityEmissionConfig();

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(facilityEmissionConfigSchema),
    defaultValues: toInputValues(
      facilityId,
      mapping?.defaultSoilTemperatureC,
      mapping?.defaultSoilTemperatureSource,
    ),
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
        200-year Removals.
      </p>
    );
  }

  const onSubmit = async (raw: unknown) => {
    try {
      const values = raw as FacilityEmissionConfigFormData;
      await saveMutation.mutateAsync(values);
      // Saved values are the new baseline, so the form is no longer unsaved.
      reset(
        toInputValues(
          facilityId,
          values.defaultSoilTemperatureC,
          values.defaultSoilTemperatureSource,
        ),
      );
      toast.success("Emission estimates saved");
    } catch (error) {
      setError("root.serverError", {
        type: "server",
        message:
          error instanceof Error ? error.message : "The estimates were not saved. Try again.",
      });
    }
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="content-measure-form flex flex-col gap-32"
    >
      <input type="hidden" {...register("facilityId")} />
      {/* Renders no footer here (the Save button below is this form's own);
          it only reports this form's dirty state to a surrounding unsaved-
          changes guard such as the settings rail. */}
      <FormActions control={control} showSubmit={false} />

      <div className="flex flex-col gap-16">
        <SectionLabel>Soil durability reference</SectionLabel>
        <FormField
          id="defaultSoilTemperatureC"
          label="Reference soil temperature (°C)"
          certifyRequired={isCertifyFormField(
            "facilityEmissionConfig", "defaultSoilTemperatureC", { durabilityOption },
          )}
          certifyStatus={certStatus("defaultSoilTemperatureC")}
          error={errors.defaultSoilTemperatureC?.message}
          helperText="Annual average soil temperature submitted to the registry for 200-year durability. Use an approved global dataset, such as Lembrechts 2022 SoilTemp. Air temperature is not accepted. Set this value before submitting a 200-year Removal. Values below 7 °C are submitted as 7 °C."
        >
          <FormInput
            id="defaultSoilTemperatureC"
            type="number"
            step="any"
            readOnly={isSubmitting}
            error={!!errors.defaultSoilTemperatureC}
            {...register("defaultSoilTemperatureC")}
          />
        </FormField>
        <FormField
          id="defaultSoilTemperatureSource"
          label="Reference dataset / region note"
          error={errors.defaultSoilTemperatureSource?.message}
          helperText="Dataset, depth, and region for the PDD audit trail, such as “Lembrechts et al. 2022 SoilTemp, 0 to 5 cm, <region>”. This note is recorded with the submission but is not sent to the registry."
        >
          <FormInput
            id="defaultSoilTemperatureSource"
            type="text"
            maxLength={SOIL_TEMPERATURE_SOURCE_MAX_LENGTH}
            readOnly={isSubmitting}
            error={!!errors.defaultSoilTemperatureSource}
            {...register("defaultSoilTemperatureSource")}
          />
        </FormField>
      </div>

      {errors.root?.serverError?.message && (
        <ServerError message={errors.root.serverError.message} />
      )}

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
