"use client";

import { SectionLabel } from "@/components/forms";
import { IngredientBinField } from "./ingredient-bin-field";
import type { UseBiocharCompositionResult } from "@/lib/biochar-composition";

interface IngredientBinRowsProps {
  composition: UseBiocharCompositionResult;
  isSubmitting: boolean;
  allocationFrozen?: boolean;
}

export function IngredientBinRows({
  composition,
  isSubmitting,
  allocationFrozen = false,
}: IngredientBinRowsProps) {
  if (composition.rows.length === 0) return null;
  return (
    <div className="space-y-16 pt-20 border-t border-[var(--color-border-tertiary)]">
      <SectionLabel>Blend ingredients</SectionLabel>
      {allocationFrozen && (
        <p className="body-small text-[var(--color-text-tertiary)]">
          Ingredient bins and masses are fixed to preserve the recorded source allocation.
        </p>
      )}
      {composition.rows.map((row) => (
        <IngredientBinField
          key={row.key}
          row={row}
          control={composition.control}
          isSubmitting={isSubmitting}
          facilityId={composition.facilityId}
          allocationFrozen={allocationFrozen}
        />
      ))}
    </div>
  );
}
