"use client";

import { FormField, FormInput } from "@/components/forms";
import { useEntityById } from "@/hooks/use-entities";
import { useEffect, useRef } from "react";
import { useController, useWatch, type Control, type FieldValues } from "react-hook-form";

export function IngredientMoistureField({ control, index, frozen, disabled }: { control: Control<FieldValues>; index: number; frozen: boolean; disabled: boolean }) {
  const prefix = `ingredientBins.${index}`;
  const binId = useWatch({ control, name: `${prefix}.storageLocationId` });
  const { field: { name, ref, onBlur, onChange, value }, fieldState } = useController({ control, name: `${prefix}.moistureContentPercent` });
  const { field: { onChange: changeSource, value: sourceValue } } = useController({ control, name: `${prefix}.moistureSource` });
  const massKg = useWatch({ control, name: `${prefix}.massKg` });
  const previousBin = useRef(binId);
  const placedAt = useWatch({ control, name: "placedAt" });
  const bin = useEntityById("storageLocation", frozen ? undefined : binId || undefined, placedAt ? { physicalDate: String(placedAt) } : undefined);
  // The server shares this remaining-stock estimate with product posting.
  const estimatedMoisture = bin.data?.mass?.moisturePercent;
  useEffect(() => {
    if (frozen) return;
    if (previousBin.current !== binId) {
      previousBin.current = binId;
      onChange(estimatedMoisture ?? null);
      changeSource("weighted_remaining");
      return;
    }
    if (sourceValue === "operator_override") return;
    onChange(estimatedMoisture ?? null);
    changeSource("weighted_remaining");
  }, [binId, frozen, estimatedMoisture, onChange, changeSource, sourceValue]);
  return <FormField id={name} label="Ingredient moisture (%)" required={Number(massKg) > 0} error={fieldState.error?.message} helperText={sourceValue === "operator_override" ? "Operator measurement" : "Prefilled from the weighted remaining stock when available."}>
    <FormInput id={name} name={name} ref={ref} onBlur={onBlur} type="number" min="0" max="99.999" step="any" value={value ?? ""} disabled={disabled || frozen} onChange={event => {
      onChange(event.target.value === "" ? null : Number(event.target.value));
      changeSource("operator_override");
    }} />
  </FormField>;
}
