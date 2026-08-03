"use client";

import { useState } from "react";
import {
  Controller,
  type Control,
  type FieldValues,
} from "react-hook-form";
import { FormField, FormInput, EntitySelect } from "@/components/forms";
import {
  StorageLocationQuickAddDialog,
  useQuickAddDialog,
} from "@/components/forms/entity-select";
import {
  COMPOSITION_BIN_TYPE,
  INGREDIENT_MASS_DEVIATION_WARN_PERCENT,
  type CompositionRow,
} from "@/lib/biochar-composition";
import { WET_MASS_FIELD_LABEL } from "@/lib/mass-moisture";
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

function formatKgShort(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatIngredientMass(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
}

/** Empty → null; parseable → number; anything else → undefined (keep draft). */
export function parseIngredientMassDraft(
  raw: string,
): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface IngredientMassInputProps {
  name: string;
  value: unknown;
  onChange: (value: number | null) => void;
  onBlur: () => void;
  inputRef: (instance: HTMLInputElement | null) => void;
  disabled: boolean;
  error: boolean;
}

export function IngredientMassInput({
  name,
  value: fieldValue,
  onChange,
  onBlur,
  inputRef,
  disabled,
  error,
}: IngredientMassInputProps) {
  const value =
    typeof fieldValue === "number" && Number.isFinite(fieldValue)
      ? fieldValue
      : null;
  const [draft, setDraft] = useState(formatIngredientMass(value));
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (parseIngredientMassDraft(draft) !== value) {
      setDraft(formatIngredientMass(value));
    }
  }

  const handleChange = (raw: string) => {
    setDraft(raw);
    const parsed = parseIngredientMassDraft(raw);
    if (parsed === undefined || parsed === syncedValue) return;
    setSyncedValue(parsed);
    onChange(parsed);
  };

  const handleBlur = () => {
    const parsed = parseIngredientMassDraft(draft);
    const committed = parsed === undefined ? null : parsed;
    setDraft(formatIngredientMass(committed));
    if (committed !== syncedValue) {
      setSyncedValue(committed);
      onChange(committed);
    }
    onBlur();
  };

  return (
    <FormInput
      id={name}
      type="number"
      step={MASS_KG_INPUT_STEP}
      min="0"
      placeholder="e.g., 120"
      disabled={disabled}
      error={error}
      value={draft}
      onChange={(event) => handleChange(event.currentTarget.value)}
      onBlur={handleBlur}
      name={name}
      ref={inputRef}
    />
  );
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
                    message: `No ${row.feedstockTypeName} feedstock bins. Create a bin here, then record a feedstock intake to add stock.`,
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
              label={WET_MASS_FIELD_LABEL}
              required
              error={fieldState.error?.message}
              helperText={
                row.suggestedMassKg != null
                  ? `Suggested: ${formatKgShort(row.suggestedMassKg)} kg. Enter the mass to confirm it.`
                  : undefined
              }
            >
              <IngredientMassInput
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                disabled={isSubmitting || allocationFrozen}
                error={!!fieldState.error}
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
