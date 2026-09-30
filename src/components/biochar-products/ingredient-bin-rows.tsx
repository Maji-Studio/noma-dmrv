"use client";

import type { AffectedStockPreview } from "@/types/output-stock";
import { IngredientBinField } from "./ingredient-bin-field";
import type { UseBiocharCompositionResult } from "@/lib/biochar-composition";

interface IngredientBinRowsProps {
  composition: UseBiocharCompositionResult;
  isSubmitting: boolean;
  allocationFrozen?: boolean;
  /** The product's stock projection, one entry per affected bin. */
  previews?: readonly AffectedStockPreview[];
  /** False while the projection refetches, failed or refuses any bin. */
  previewsAvailable?: boolean;
}

/**
 * The formulation's blend ingredients, each drawn from the feedstock bin that
 * holds it. The section title already names them, so the rows carry no label
 * of their own.
 */
export function IngredientBinRows({
  composition,
  isSubmitting,
  allocationFrozen = false,
  previews,
  previewsAvailable = false,
}: IngredientBinRowsProps) {
  if (composition.rows.length === 0) return null;
  return (
    <div className="space-y-20">
      {allocationFrozen && (
        <p className="body-caption text-[var(--color-text-tertiary)]">
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
          previews={previews}
          previewsAvailable={previewsAvailable}
        />
      ))}
    </div>
  );
}
