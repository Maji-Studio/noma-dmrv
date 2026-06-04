"use client";

/**
 * useBiocharComposition
 *
 * Caller-facing React hook that owns the form-side composition concerns:
 *   - the `ingredientBins` field array,
 *   - the formulation fetch (via `useFormulation`),
 *   - the formulation-change sync effect (preserves user-entered fields),
 *   - the facility-change cascade (clears each row's `storageLocationId`),
 *   - the removal-kg derivation per row.
 *
 * The form passes its `useForm` return value in and renders rows from the
 * `rows` array — no `useFieldArray`, no sync effect, no inline math.
 */

import { useEffect, useRef } from "react";
import {
  useFieldArray,
  type Control,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { useFormulation } from "@/hooks/use-formulations";
import { reconcileComposition, deriveBinRemovalKg } from "./composition";
import type { CompositionRow, IngredientBin } from "./types";

export interface UseBiocharCompositionArgs {
  formulationId: string | null | undefined;
  facilityId: string | null | undefined;
  productMassKg: number | null | undefined;
  /**
   * The id of the formulation already linked to the product when editing.
   * Treated as "already synced" so existing rows are not blown away on mount.
   */
  initialFormulationId?: string | null | undefined;
}

export interface UseBiocharCompositionResult {
  rows: CompositionRow[];
  isLoading: boolean;
  facilityId: string;
  /** Cast control suitable for passing to the row renderer. */
  control: Control<FieldValues>;
}

type IngredientField = Required<IngredientBin> & { id: string };

/**
 * Loose `UseFormReturn` so callers can pass a precisely-typed form (with
 * Zod-inferred fields) without a manual cast. The form schema's `z.preprocess`
 * widens input types to `unknown`, which fights `Control<TForm>` invariance.
 * This single `any` is the same shape-erasure the form previously did inline.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseForm = UseFormReturn<any>;

export function useBiocharComposition(
  form: LooseForm,
  args: UseBiocharCompositionArgs,
): UseBiocharCompositionResult {
  const { formulationId, facilityId, productMassKg, initialFormulationId } = args;

  const control = form.control as Control<FieldValues>;
  const { fields, replace } = useFieldArray({ control, name: "ingredientBins" });
  const ingredientFields = fields as unknown as IngredientField[];

  const { data: formulation, isLoading } = useFormulation(
    formulationId ?? "",
    !!formulationId,
  );

  // Sync rows when the formulation changes. Guarded by a ref so initial mount
  // (when `defaultValues.ingredientBins` was hydrated from the existing
  // product) does not overwrite user-entered fields.
  const syncedFormulationIdRef = useRef(initialFormulationId ?? "");
  useEffect(() => {
    // Pure-biochar product (no formulation) → no ingredient bins. Clear any rows
    // left over from a previously-selected formulation.
    if (!formulationId) {
      if (syncedFormulationIdRef.current !== "") {
        syncedFormulationIdRef.current = "";
        replace([]);
      }
      return;
    }
    if (!formulation?.ingredients) return;
    if (formulation.id === syncedFormulationIdRef.current) return;
    syncedFormulationIdRef.current = formulation.id;

    const live = (form.getValues("ingredientBins") as IngredientBin[] | undefined) ?? [];
    const next = reconcileComposition(formulation, live);
    replace(next);
  }, [formulationId, formulation, form, replace]);

  // Facility cascade: clear each row's storageLocationId when the user picks
  // a different facility. Skips the initial mount.
  const previousFacilityIdRef = useRef(facilityId ?? "");
  useEffect(() => {
    const current = facilityId ?? "";
    if (current === previousFacilityIdRef.current) return;
    previousFacilityIdRef.current = current;

    const live = (form.getValues("ingredientBins") as IngredientBin[] | undefined) ?? [];
    live.forEach((row, i) => {
      if (row?.storageLocationId != null) {
        form.setValue(`ingredientBins.${i}.storageLocationId`, null);
      }
    });
  }, [facilityId, form]);

  const biocharRatio = formulation?.biocharRatio ?? null;
  const productMass = typeof productMassKg === "number" ? productMassKg : null;

  const rows: CompositionRow[] = ingredientFields.map((field, index) => ({
    key: field.id,
    index,
    formulationIngredientId: field.formulationIngredientId,
    ingredientName: field.ingredientName,
    ingredientType: field.ingredientType,
    ratio: field.ratio ?? null,
    removalKg: deriveBinRemovalKg(productMass, biocharRatio, field.ratio ?? null),
    storageLocationFieldName: `ingredientBins.${index}.storageLocationId` as const,
  }));

  return {
    rows,
    isLoading,
    facilityId: facilityId ?? "",
    control,
  };
}
