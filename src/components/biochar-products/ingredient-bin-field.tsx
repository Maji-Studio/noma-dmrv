"use client";

import { Controller, type Control, type FieldValues } from "react-hook-form";
import { FormField, FormInput, EntitySelect } from "@/components/forms";
import {
  StorageLocationQuickAddDialog,
  useQuickAddDialog,
} from "@/components/forms/entity-select";
import {
  COMPOSITION_BIN_TYPE,
  type CompositionRow,
} from "@/lib/biochar-composition";
import { MASS_KG_INPUT_STEP } from "@/schemas/helpers";
import { formatStorageLocationType } from "@/schemas/storage-locations";

// The storage-location option subtitle for a feedstock bin starts with
// "Feedstock bin · " (formatStorageLocationType). Strip it from the selected
// label so the row doesn't repeat the bin kind it already lives under.
const FEEDSTOCK_BIN_PREFIX = `${formatStorageLocationType(COMPOSITION_BIN_TYPE)} · `;
const FEEDSTOCK_BIN_QUICK_ADD_TYPES = [COMPOSITION_BIN_TYPE] as const;

export function formatIngredientBinLabel(entity: {
  name: string;
  subtitle?: string;
}): string {
  const parts = [entity.name];
  if (entity.subtitle) {
    parts.push(entity.subtitle.replace(FEEDSTOCK_BIN_PREFIX, ""));
  }
  return parts.join(" · ");
}

interface IngredientBinFieldProps {
  row: CompositionRow;
  control: Control<FieldValues>;
  isSubmitting: boolean;
  facilityId: string;
  allocationFrozen?: boolean;
}

export function IngredientBinField({
  row,
  control,
  isSubmitting,
  facilityId,
  allocationFrozen = false,
}: IngredientBinFieldProps) {
  const feedstockBinDialog = useQuickAddDialog();

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-12 gap-y-12">
      <div className="md:col-span-2">
        <Controller
          name={row.storageLocationFieldName}
          control={control}
          render={({ field, fieldState }) => (
            <>
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
                  disabled={isSubmitting || allocationFrozen}
                  error={!!fieldState.error}
                  filterBy={{
                    ...(facilityId ? { facilityId } : {}),
                    type: COMPOSITION_BIN_TYPE,
                    feedstockTypeId: row.feedstockTypeId,
                    feedstockTypeUsage: "blend",
                  }}
                  formatSelectedLabel={formatIngredientBinLabel}
                  allowCreate={!allocationFrozen}
                  emptyHint={{
                    message: `No ${row.feedstockTypeName} feedstock bins yet.`,
                  }}
                  createLabel={`Create ${row.feedstockTypeName} feedstock bin`}
                  onCreateNew={
                    facilityId && !allocationFrozen
                      ? feedstockBinDialog.open
                      : undefined
                  }
                />
              </FormField>

              {facilityId && (
                <StorageLocationQuickAddDialog
                  isOpen={feedstockBinDialog.isOpen}
                  onClose={feedstockBinDialog.close}
                  onSuccess={(entity) => {
                    field.onChange(entity.id);
                    feedstockBinDialog.close();
                  }}
                  defaultBinType={COMPOSITION_BIN_TYPE}
                  allowedTypes={FEEDSTOCK_BIN_QUICK_ADD_TYPES}
                  defaultFeedstockTypeId={row.feedstockTypeId}
                  feedstockTypeUsage="blend"
                  lockFeedstockType
                  facilityId={facilityId}
                />
              )}
            </>
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
            >
              <FormInput
                id={row.massKgFieldName}
                type="number"
                step={MASS_KG_INPUT_STEP}
                min="0"
                placeholder="e.g., 120"
                disabled={isSubmitting || allocationFrozen}
                error={!!fieldState.error}
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
              />
            </FormField>
          </div>
        )}
      />
    </div>
  );
}
