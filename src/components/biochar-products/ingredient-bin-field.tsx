"use client";

import { Controller, type Control, type FieldValues } from "react-hook-form";
import { FormField, EntitySelect } from "@/components/forms";
import { INGREDIENT_TYPE_LABELS } from "@/schemas/formulations";
import { COMPOSITION_BIN_TYPE, type CompositionRow } from "@/lib/biochar-composition";

const INGREDIENT_BIN_PREFIX = "Ingredient Bin · ";

interface IngredientBinFieldProps {
  row: CompositionRow;
  control: Control<FieldValues>;
  isSubmitting: boolean;
  facilityId: string;
}

export function IngredientBinField({
  row,
  control,
  isSubmitting,
  facilityId,
}: IngredientBinFieldProps) {
  const typeLabel =
    INGREDIENT_TYPE_LABELS[row.ingredientType as keyof typeof INGREDIENT_TYPE_LABELS]
    ?? row.ingredientType;

  const formatLabel = (entity: { name: string; subtitle?: string }) => {
    const parts = [entity.name];
    if (entity.subtitle) parts.push(entity.subtitle.replace(INGREDIENT_BIN_PREFIX, ""));
    if (row.removalKg) parts.push(`(−${row.removalKg.toFixed(0)} kg)`);
    return parts.join(" · ");
  };

  return (
    <FormField
      id={row.storageLocationFieldName}
      label={row.ingredientName}
      helperText={typeLabel}
    >
      <Controller
        name={row.storageLocationFieldName}
        control={control}
        render={({ field }) => (
          <EntitySelect
            entityType="storageLocation"
            value={field.value || ""}
            onChange={field.onChange}
            placeholder="Select an ingredient bin..."
            disabled={isSubmitting}
            filterBy={{
              ...(facilityId ? { facilityId } : {}),
              type: COMPOSITION_BIN_TYPE,
            }}
            formatSelectedLabel={formatLabel}
          />
        )}
      />
    </FormField>
  );
}
