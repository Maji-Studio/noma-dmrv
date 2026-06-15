"use client";

import { Controller, type Control, type FieldValues } from "react-hook-form";
import { FormField, EntitySelect } from "@/components/forms";
import { COMPOSITION_BIN_TYPE, type CompositionRow } from "@/lib/biochar-composition";

// The storage-location option subtitle for a feedstock bin starts with
// "Feedstock Bin · " (formatStorageLocationType). Strip it from the selected
// label so the row doesn't repeat the bin kind it already lives under.
const FEEDSTOCK_BIN_PREFIX = "Feedstock Bin · ";

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
  const formatLabel = (entity: { name: string; subtitle?: string }) => {
    const parts = [entity.name];
    if (entity.subtitle) parts.push(entity.subtitle.replace(FEEDSTOCK_BIN_PREFIX, ""));
    if (row.removalKg) parts.push(`(−${row.removalKg.toFixed(0)} kg)`);
    return parts.join(" · ");
  };

  return (
    <Controller
      name={row.storageLocationFieldName}
      control={control}
      render={({ field, fieldState }) => (
        <FormField
          id={row.storageLocationFieldName}
          label={row.feedstockTypeName}
          helperText={row.feedstockTypeCategory}
          error={fieldState.error?.message}
        >
          <EntitySelect
            entityType="storageLocation"
            value={field.value || ""}
            onChange={field.onChange}
            placeholder="Select a feedstock bin..."
            disabled={isSubmitting}
            filterBy={{
              ...(facilityId ? { facilityId } : {}),
              type: COMPOSITION_BIN_TYPE,
              feedstockTypeId: row.feedstockTypeId,
              feedstockTypeUsage: "blend",
            }}
            formatSelectedLabel={formatLabel}
          />
        </FormField>
      )}
    />
  );
}
