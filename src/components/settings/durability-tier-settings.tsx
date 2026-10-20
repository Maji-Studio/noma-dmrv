/**
 * The facility's durability tier on Settings, Facilities (Q9). It moved here
 * from the facility form: the tier is certification configuration declared
 * once per facility (ADR 0021), not site master data. Same control and same
 * rules as before (1000-year selectable, 200-year shown locked until a
 * 200-year client onboards), saved through the facility update action with
 * only the tier in the payload, so the server's durability lock still applies.
 *
 * Members see the tier as read-only information.
 */
"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { DurabilityTierSelect } from "@/components/certification/durability-tier-select";
import { FormActions, FormField } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import type { Facility } from "@/db/schema";
import { useUpdateFacility } from "@/hooks/use-facilities";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { durabilityOptions, type DurabilityOption } from "@/schemas/facilities";

/** 1000-year is the go-forward tier (ADR 0021) and the column default. */
const DEFAULT_DURABILITY_OPTION: DurabilityOption = "1000_year";

export const DURABILITY_TIER_HINT =
  "Set once for your registry program and inherited by every credit batch and Sample at this facility. The 200-year pathway opens when a 200-year client onboards.";

function resolveTier(option: Facility["durabilityOption"] | null | undefined): DurabilityOption {
  return durabilityOptions.includes(option as DurabilityOption)
    ? (option as DurabilityOption)
    : DEFAULT_DURABILITY_OPTION;
}

export function DurabilityTierSettings({
  facility,
  canManage,
}: {
  facility: Facility;
  canManage: boolean;
}) {
  const savedTier = resolveTier(facility.durabilityOption);

  if (!canManage) {
    return (
      <FormField id="facility-durability-tier" label="Durability tier" hint={DURABILITY_TIER_HINT}>
        <DurabilityTierSelect value={savedTier} readOnly aria-label="Facility durability tier" />
      </FormField>
    );
  }

  // Keyed on the saved tier and version: react-hook-form reads `defaultValues`
  // once, so a remount is how a saved or refetched tier reaches the control.
  return (
    <DurabilityTierForm
      key={`${facility.id}-${facility.version}-${savedTier}`}
      facility={facility}
      savedTier={savedTier}
    />
  );
}

function DurabilityTierForm({
  facility,
  savedTier,
}: {
  facility: Facility;
  savedTier: DurabilityOption;
}) {
  const toast = useToast();
  const updateFacility = useUpdateFacility();
  const [serverError, setServerError] = useState("");
  const { control, handleSubmit, setValue } = useForm<{ durabilityOption: DurabilityOption }>({
    defaultValues: { durabilityOption: savedTier },
  });
  const tier = useWatch({ control, name: "durabilityOption" }) ?? savedTier;

  const onSubmit = handleSubmit(async ({ durabilityOption }) => {
    setServerError("");
    try {
      await updateFacility.mutateAsync({
        facilityId: facility.id,
        // The version this pane loaded, so a concurrent edit is refused
        // instead of silently overwritten (#768).
        expectedVersion: facility.version,
        durabilityOption,
      });
      toast.success(`Durability tier saved for ${facility.code}.`);
    } catch (error) {
      setServerError(toSaveErrorMessage(error, "The durability tier was not saved. Try again."));
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-16">
      <FormField id="facility-durability-tier" label="Durability tier" hint={DURABILITY_TIER_HINT}>
        <DurabilityTierSelect
          value={tier}
          onChange={(value) => setValue("durabilityOption", value, { shouldDirty: true })}
          disabled={updateFacility.isPending}
          aria-label="Facility durability tier"
        />
      </FormField>
      <FormActions
        control={control}
        isSubmitting={updateFacility.isPending}
        errorMessage={serverError}
        showSubmit={tier !== savedTier}
        submitLabel="Save durability tier"
        submittingLabel="Saving…"
        sticky={false}
      />
    </form>
  );
}
