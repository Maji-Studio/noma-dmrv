"use client";

import { EntitySelect, FormField, FormInput } from "@/components/forms";
import {
  StorageLocationQuickAddDialog,
  useQuickAddDialog,
} from "@/components/forms/entity-select";
import {
  COMPOSITION_BIN_TYPE,
  type CompositionRow,
} from "@/lib/biochar-composition";
import { WET_MASS_FIELD_LABEL } from "@/lib/mass-moisture";
import { MASS_KG_INPUT_STEP } from "@/schemas/helpers";
import { formatStorageLocationType } from "@/schemas/storage-locations";
import { StockChangeLabel } from "@/components/storage-locations/stock-change-label";
import type { AffectedStockPreview } from "@/types/output-stock";
import { useState } from "react";
import {
  Controller,
  type Control,
  type FieldValues,
} from "react-hook-form";
import { AffectedBinNotices } from "./affected-bin-notices";
import { IngredientMassSplit } from "./ingredient-mass-split";
import { IngredientMoistureField } from "./ingredient-moisture-field";

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
  // Intentionally adjust during render when the form value changes externally;
  // a useEffect would briefly render the stale draft before synchronizing it.
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
  /** The product's stock projection, one entry per affected bin. */
  previews?: readonly AffectedStockPreview[];
  /** False while the projection refetches, failed or refuses any bin. */
  previewsAvailable?: boolean;
}

/** This ingredient's bin in the projection, matched on the selected bin. */
function ingredientPreview(
  previews: readonly AffectedStockPreview[] | undefined,
  storageLocationId: unknown,
): AffectedStockPreview | undefined {
  if (typeof storageLocationId !== "string" || !storageLocationId) return undefined;
  return previews?.find(
    (preview) => preview.lane === "ingredient" && preview.storageLocationId === storageLocationId,
  );
}

/**
 * One blend ingredient: the feedstock bin it is drawn from, with the draw in
 * the selector, then its wet mass and moisture, then their split.
 */
export function IngredientBinField({
  row,
  control,
  isSubmitting,
  facilityId,
  allocationFrozen = false,
  previews,
  previewsAvailable = false,
}: IngredientBinFieldProps) {
  const feedstockBinDialog = useQuickAddDialog();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
      <div className="md:col-span-2 flex flex-col gap-8">
        <Controller
          name={row.storageLocationFieldName}
          control={control}
          render={({ field, fieldState }) => {
            const stock = ingredientPreview(previews, field.value);
            return (
              <>
                <FormField
                  id={row.storageLocationFieldName}
                  label={`${row.feedstockTypeName} bin`}
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
                    formatSelectedLabel={(entity) => (
                      <StockChangeLabel
                        name={formatIngredientBinLabel(entity)}
                        preview={stock}
                        available={previewsAvailable}
                      />
                    )}
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
                <AffectedBinNotices preview={stock} />

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
            );
          }}
        />
      </div>

      <Controller
        name={row.massKgFieldName}
        control={control}
        render={({ field, fieldState }) => (
          <FormField
            id={row.massKgFieldName}
            label={WET_MASS_FIELD_LABEL}
            required
            error={fieldState.error?.message}
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
        )}
      />
      <IngredientMoistureField control={control} index={row.index} frozen={allocationFrozen} disabled={isSubmitting} />
      <div className="md:col-span-2">
        <IngredientMassSplit
          control={control}
          index={row.index}
          feedstockTypeName={row.feedstockTypeName}
          frozen={allocationFrozen}
        />
      </div>
    </div>
  );
}
