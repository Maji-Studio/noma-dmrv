"use client";

import { FormField, FormInput } from "@/components/forms";
import { useEntityById } from "@/hooks/use-entities";
import { MOISTURE_BASIS_HINT } from "@/lib/mass-moisture";
import { moistureReadingGuidance } from "@/lib/output-stock/moisture-guidance";
import { useController, useWatch, type Control, type FieldValues } from "react-hook-form";

/** Ingredient bins keep wet stock, so their estimate comes from the intakes still in the bin, not a reading. */
const INGREDIENT_ESTIMATE_BASIS = "From the intakes still in this ingredient bin.";

/**
 * The measured moisture of the ingredient added. It starts empty: the bin's
 * weighted remaining estimate is a hint and a check, never the value.
 */
export function IngredientMoistureField({ control, index, frozen, disabled }: { control: Control<FieldValues>; index: number; frozen: boolean; disabled: boolean }) {
  const prefix = `ingredientBins.${index}`;
  const binId = useWatch({ control, name: `${prefix}.storageLocationId` });
  const { field: { name, ref, onBlur, onChange, value }, fieldState } = useController({ control, name: `${prefix}.moistureContentPercent` });
  const massKg = useWatch({ control, name: `${prefix}.massKg` });
  const placedAt = useWatch({ control, name: "placedAt" });
  const bin = useEntityById("storageLocation", frozen ? undefined : binId || undefined, placedAt ? { occurredAt: String(placedAt) } : undefined);
  const estimatedMoisture = bin.data?.mass?.moisturePercent;
  const guidance = moistureReadingGuidance(
    typeof estimatedMoisture === "number" ? { moisturePercent: estimatedMoisture, basisText: INGREDIENT_ESTIMATE_BASIS } : null,
    typeof value === "number" ? value : null,
  );
  return <FormField id={name} label="Ingredient moisture (%)" required={Number(massKg) > 0} error={fieldState.error?.message} warning={guidance.warning} cue={guidance.cue} hint={guidance.basisText ? <>{guidance.basisText} {MOISTURE_BASIS_HINT}</> : MOISTURE_BASIS_HINT}>
    <FormInput id={name} name={name} ref={ref} onBlur={onBlur} type="number" min="0" max="99.999" step="any" value={value ?? ""} disabled={disabled || frozen} onChange={event => onChange(event.target.value === "" ? null : Number(event.target.value))} />
  </FormField>;
}
