/**
 * The facility's durability tier on Settings, Facilities (Q9). It moved here
 * from the facility form: the tier is certification configuration declared
 * once per facility (ADR 0021), not site master data. Same control and same
 * rules as before (1000-year selectable, 200-year shown locked until a
 * 200-year client onboards), saved through the facility update action with
 * only the tier in the payload, so the server's durability lock and its
 * Owner/Admin rule apply.
 *
 * The save is not optimistic. An optimistic write changes the facility in the
 * cache before the server answers, and a refusal (the tier is locked by a
 * registry submission, a concurrent edit) would then arrive at a form that
 * had already moved on. The form stays mounted for the facility while the
 * request settles, and follows a refetched tier only where the operator has
 * not chosen one.
 *
 * Members see the tier as read-only information.
 */
"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { DurabilityTierSelect } from "@/components/certification/durability-tier-select";
import { FormActions, FormField } from "@/components/forms";
import { Notice } from "@/components/ui/notice";
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
  blockedReason,
}: {
  facility: Facility;
  canManage: boolean;
  /**
   * Why a changed tier cannot be saved yet, such as an unsaved soil reference
   * draft the change would drop. Replaces the Save action while set.
   */
  blockedReason?: string;
}) {
  const savedTier = resolveTier(facility.durabilityOption);

  if (!canManage) {
    return (
      <FormField id="facility-durability-tier" label="Durability tier" hint={DURABILITY_TIER_HINT}>
        <DurabilityTierSelect value={savedTier} readOnly aria-label="Facility durability tier" />
      </FormField>
    );
  }

  // Keyed on the facility only: a remount mid-request would drop the pending
  // state and the server's answer.
  return (
    <DurabilityTierForm
      key={facility.id}
      facility={facility}
      savedTier={savedTier}
      blockedReason={blockedReason}
    />
  );
}

function DurabilityTierForm({
  facility,
  savedTier,
  blockedReason,
}: {
  facility: Facility;
  savedTier: DurabilityOption;
  blockedReason?: string;
}) {
  const toast = useToast();
  const updateFacility = useUpdateFacility(undefined, { optimistic: false });
  const [serverError, setServerError] = useState("");
  const { control, handleSubmit, setValue, reset } = useForm<{ durabilityOption: DurabilityOption }>({
    defaultValues: { durabilityOption: savedTier },
    // A refetched tier (another tab, a saved change) replaces the baseline
    // without overwriting a tier the operator has picked and not saved.
    values: { durabilityOption: savedTier },
    resetOptions: { keepDirtyValues: true },
  });
  const tier = useWatch({ control, name: "durabilityOption" }) ?? savedTier;
  const changed = tier !== savedTier;
  const blocked = changed && !!blockedReason;

  const onSubmit = handleSubmit(async ({ durabilityOption }) => {
    if (blockedReason) return;
    setServerError("");
    try {
      await updateFacility.mutateAsync({
        facilityId: facility.id,
        // The version this pane loaded, so a concurrent edit is refused
        // instead of silently overwritten (#768).
        expectedVersion: facility.version,
        durabilityOption,
      });
      reset({ durabilityOption });
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
          onChange={(value) => {
            setServerError("");
            setValue("durabilityOption", value, { shouldDirty: true });
          }}
          disabled={updateFacility.isPending}
          aria-label="Facility durability tier"
        />
      </FormField>
      {blocked && <Notice tone="warning">{blockedReason}</Notice>}
      <FormActions
        control={control}
        isSubmitting={updateFacility.isPending}
        errorMessage={serverError}
        showSubmit={changed && !blocked}
        submitLabel="Save durability tier"
        submittingLabel="Saving…"
        sticky={false}
      />
    </form>
  );
}
