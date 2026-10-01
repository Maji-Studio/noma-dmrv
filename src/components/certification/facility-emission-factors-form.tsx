/**
 * FacilityEmissionFactorsForm: the per-facility factors the Energy page uses
 * to estimate CO2e (ADR 0031). Works without a registry link.
 *
 * Diesel and road freight prefill with DEFRA 2024 values when nothing is
 * saved yet; grid electricity starts empty because it is country-specific.
 * Owners and Admins edit; every other member reads the saved values.
 */
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { GaugeIcon } from "@phosphor-icons/react/dist/ssr";
import { useForm } from "react-hook-form";
import {
  FormActions,
  FormField,
  FormInput,
  FormSection,
  ServerError,
} from "@/components/forms";
import { EmptyState } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import {
  DEFAULT_DIESEL_KG_CO2E_PER_LITRE,
  DEFAULT_ROAD_FREIGHT_KG_CO2E_PER_TONNE_KM,
  EMISSION_FACTOR_SOURCE_NOTE_MAX_LENGTH,
} from "@/config/emission-factors";
import type { FacilityEmissionFactors } from "@/data-access/facility-emission-factors";
import {
  useFacilityEmissionFactors,
  useSaveFacilityEmissionFactors,
} from "@/hooks/use-energy";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { toSaveErrorMessage } from "@/lib/stale-version";
import {
  facilityEmissionFactorsFormSchema,
  type FacilityEmissionFactorsInput,
  type FacilityEmissionFactorsValues,
} from "@/schemas/emission-factors";

const LOADING_CLASS = "h-320 w-full";

const FIELDS = [
  {
    name: "dieselKgCo2ePerLitre",
    label: "Diesel",
    unit: "kg CO₂e/L",
    helperText: `Startup, genset and preprocessing fuel. DEFRA 2024 diesel is ${DEFAULT_DIESEL_KG_CO2E_PER_LITRE}.`,
  },
  {
    name: "gridKgCo2ePerKwh",
    label: "Grid electricity",
    unit: "kg CO₂e/kWh",
    helperText:
      "Your country's grid average. A run's low-carbon share is taken off before this applies.",
  },
  {
    name: "roadFreightKgCo2ePerTonneKm",
    label: "Road freight",
    unit: "kg CO₂e/t·km",
    helperText: `Feedstock and biochar trucks, counted as a round trip. DEFRA 2024 articulated HGV is ${DEFAULT_ROAD_FREIGHT_KG_CO2E_PER_TONNE_KM}.`,
  },
] as const;

function formatFactor(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

export function FacilityEmissionFactorsForm({ facilityId }: { facilityId: string }) {
  const query = useFacilityEmissionFactors(facilityId);

  if (query.isLoading && !query.data) {
    return <Skeleton className={LOADING_CLASS} />;
  }
  if (!query.data) {
    return (
      <ServerError message="The emission factors could not be loaded. Refresh the page to retry." />
    );
  }

  const { factors, viewerCanManage } = query.data;
  if (!viewerCanManage) {
    return <SavedFactors factors={factors} />;
  }
  // Keyed on the saved row: react-hook-form reads `defaultValues` once, so a
  // remount is how saved values reach the inputs.
  return (
    <FactorsForm
      key={`${facilityId}:${factors?.updatedAt.toString() ?? "new"}`}
      facilityId={facilityId}
      factors={factors}
    />
  );
}

function SavedFactors({ factors }: { factors: FacilityEmissionFactors | null }) {
  if (!factors) {
    return (
      <EmptyState
        icon={<GaugeIcon size={32} />}
        title="No emission factors set for this facility"
        description="Only Owners and Admins can set them."
        padding="sm"
      />
    );
  }
  return (
    <dl className="content-measure-form grid grid-cols-1 gap-y-12 sm:grid-cols-2">
      {FIELDS.map((field) => (
        <div key={field.name} className="flex flex-col gap-4">
          <dt className="body-caption text-[var(--color-text-secondary)]">{field.label}</dt>
          <dd className="body-medium tabular-nums">
            {formatFactor(factors[field.name])} {field.unit}
          </dd>
        </div>
      ))}
      <div className="flex flex-col gap-4 sm:col-span-2">
        <dt className="body-caption text-[var(--color-text-secondary)]">Source</dt>
        <dd className="body-medium">{factors.sourceNote ?? MISSING_VALUE.notRecorded}</dd>
      </div>
    </dl>
  );
}

function FactorsForm({
  facilityId,
  factors,
}: {
  facilityId: string;
  factors: FacilityEmissionFactors | null;
}) {
  const toast = useToast();
  const saveMutation = useSaveFacilityEmissionFactors();
  const [serverError, setServerError] = useState("");
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FacilityEmissionFactorsInput, unknown, FacilityEmissionFactorsValues>({
    resolver: zodResolver(facilityEmissionFactorsFormSchema),
    defaultValues: {
      dieselKgCo2ePerLitre: factors?.dieselKgCo2ePerLitre ?? DEFAULT_DIESEL_KG_CO2E_PER_LITRE,
      gridKgCo2ePerKwh: factors?.gridKgCo2ePerKwh ?? "",
      roadFreightKgCo2ePerTonneKm:
        factors?.roadFreightKgCo2ePerTonneKm ?? DEFAULT_ROAD_FREIGHT_KG_CO2E_PER_TONNE_KM,
      sourceNote: factors?.sourceNote ?? "",
    },
  });

  async function onSubmit(values: FacilityEmissionFactorsValues) {
    setServerError("");
    try {
      await saveMutation.mutateAsync({
        ...values,
        facilityId,
        // The version this form opened on; null when it opened on no row, so a
        // concurrent first save is refused instead of overwritten.
        expectedUpdatedAt: factors?.updatedAt ?? null,
      });
      toast.success("Emission factors saved.");
    } catch (error) {
      setServerError(toSaveErrorMessage(error, "The emission factors were not saved. Try again."));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="content-measure-form flex flex-col gap-24">
      <FormSection title="Factors" divider={false}>
        <div className="grid grid-cols-1 gap-x-16 gap-y-20 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <FormField
              key={field.name}
              id={`emission-factor-${field.name}`}
              label={field.label}
              unit={field.unit}
              helperText={field.helperText}
              error={errors[field.name]?.message}
            >
              <FormInput
                id={`emission-factor-${field.name}`}
                type="number"
                step="any"
                min={0}
                inputMode="decimal"
                error={!!errors[field.name]}
                {...register(field.name)}
              />
            </FormField>
          ))}
        </div>
        <FormField
          id="emission-factor-source"
          label="Source"
          error={errors.sourceNote?.message}
          helperText="Where these factors come from, for example a dataset and year or your LCA."
        >
          <FormInput
            id="emission-factor-source"
            type="text"
            maxLength={EMISSION_FACTOR_SOURCE_NOTE_MAX_LENGTH}
            placeholder="e.g., DEFRA 2024 conversion factors"
            error={!!errors.sourceNote}
            {...register("sourceNote")}
          />
        </FormField>
      </FormSection>

      <p className="body-caption text-[var(--color-text-tertiary)]">
        These factors only estimate CO₂e on the Energy page. Isometric applies its
        own factors to what you submit.
      </p>

      <FormActions
        control={control}
        isSubmitting={saveMutation.isPending}
        errorMessage={serverError}
        submitLabel="Save factors"
        submittingLabel="Saving…"
        sticky={false}
      />
    </form>
  );
}
