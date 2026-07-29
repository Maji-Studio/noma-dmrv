"use client";

import { Controller, type Control, type FieldValues } from "react-hook-form";
import { FormField, FormInput, EntitySelect } from "@/components/forms";
import {
  COMPOSITION_BIN_TYPE,
  INGREDIENT_MASS_DEVIATION_WARN_PERCENT,
  type CompositionRow,
} from "@/lib/biochar-composition";
import { MASS_KG_INPUT_STEP } from "@/schemas/helpers";
import { formatStorageLocationType } from "@/schemas/storage-locations";

// The storage-location option subtitle for a feedstock bin starts with
// "Feedstock bin · " (formatStorageLocationType). Strip it from the selected
// label so the row doesn't repeat the bin kind it already lives under.
const FEEDSTOCK_BIN_PREFIX = `${formatStorageLocationType(COMPOSITION_BIN_TYPE)} · `;

function formatKgShort(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

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
    return parts.join(" · ");
  };

  const showDeviation =
    row.deviationPercent != null &&
    Math.abs(row.deviationPercent) >= INGREDIENT_MASS_DEVIATION_WARN_PERCENT;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-12 gap-y-12">
      <div className="md:col-span-2">
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
                error={!!fieldState.error}
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
      </div>

      <Controller
        name={row.massKgFieldName}
        control={control}
        render={({ field, fieldState }) => (
          <div>
            <FormField
              id={row.massKgFieldName}
              label="Mass (kg)"
              required
              error={fieldState.error?.message}
              helperText={
                row.suggestedMassKg != null
                  ? `Suggested: ${formatKgShort(row.suggestedMassKg)} kg. Enter the mass to confirm it.`
                  : undefined
              }
            >
              <FormInput
                id={row.massKgFieldName}
                type="number"
                step={MASS_KG_INPUT_STEP}
                min="0"
                placeholder="e.g., 120"
                disabled={isSubmitting}
                error={!!fieldState.error}
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            </FormField>
            {showDeviation && row.deviationPercent != null && (
              <p className="body-caption text-[var(--st-wait)] mt-4">
                {row.deviationPercent > 0 ? "+" : ""}
                {row.deviationPercent.toFixed(0)}% vs recipe. Recorded as
                entered.
              </p>
            )}
          </div>
        )}
      />
    </div>
  );
}
