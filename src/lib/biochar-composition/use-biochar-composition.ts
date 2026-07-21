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
  useWatch,
  type Control,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { useFormulation } from "@/hooks/use-formulations";
import {
  deriveMassDeviationPercent,
  deriveSuggestedIngredientMassKg,
  reconcileComposition,
} from "./composition";
import type { CompositionRow, IngredientBin } from "./types";

/** Mass inputs step 0.01 kg — round auto-filled suggestions to match. */
const SUGGESTED_MASS_DECIMALS = 100;

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
  const initialRows = (form.getValues("ingredientBins") as IngredientBin[] | undefined) ?? [];
  const syncedFormulationIdRef = useRef(
    initialFormulationId && initialRows.length > 0 ? initialFormulationId : ""
  );
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

  // Prefill each row's mass from the recipe suggestion. A suggestion only
  // ever writes over an empty field or its own previous auto-filled value —
  // a mass the user typed (dirty) or one hydrated from a saved product is
  // never touched, so the recipe stays orientation, not enforcement.
  const autoFilledMassRef = useRef<Record<string, number>>({});
  const { dirtyFields } = form.formState;
  useEffect(() => {
    const ingredients = formulation?.ingredients;
    if (!ingredients) return;
    const live = (form.getValues("ingredientBins") as IngredientBin[] | undefined) ?? [];
    live.forEach((row, i) => {
      if (!row) return;
      const ingredient = ingredients.find(
        (ing: { id: string }) => ing.id === row.formulationIngredientId,
      );
      const suggested = deriveSuggestedIngredientMassKg(
        productMass,
        formulation?.biocharRatio ?? null,
        ingredient?.ratio ?? null,
      );
      if (suggested == null) return;
      const rounded =
        Math.round(suggested * SUGGESTED_MASS_DECIMALS) / SUGGESTED_MASS_DECIMALS;
      const isDirty = !!dirtyFields?.ingredientBins?.[i]?.massKg;
      const previousAuto = autoFilledMassRef.current[row.formulationIngredientId];
      const isEmptyOrAuto = row.massKg == null || row.massKg === previousAuto;
      if (isDirty || !isEmptyOrAuto || row.massKg === rounded) return;
      autoFilledMassRef.current[row.formulationIngredientId] = rounded;
      form.setValue(`ingredientBins.${i}.massKg`, rounded, {
        shouldDirty: false,
        shouldValidate: false,
      });
    });
  }, [formulation, productMass, form, dirtyFields]);

  // Live values (not the field-array snapshot) so the deviation hint tracks
  // the user's typing.
  const liveBins = useWatch({ control, name: "ingredientBins" }) as
    | IngredientBin[]
    | undefined;

  const rows: CompositionRow[] = ingredientFields.map((field, index) => {
    const suggestedMassKg = deriveSuggestedIngredientMassKg(
      productMass,
      biocharRatio,
      field.ratio ?? null,
    );
    const liveMassRaw = liveBins?.[index]?.massKg as
      | number
      | string
      | null
      | undefined;
    const liveMassKg =
      typeof liveMassRaw === "number"
        ? liveMassRaw
        : liveMassRaw != null && liveMassRaw !== ""
          ? Number(liveMassRaw)
          : null;
    return {
      key: field.id,
      index,
      formulationIngredientId: field.formulationIngredientId,
      feedstockTypeId: field.feedstockTypeId,
      feedstockTypeName: field.feedstockTypeName,
      feedstockTypeCategory: field.feedstockTypeCategory,
      ratio: field.ratio ?? null,
      suggestedMassKg,
      deviationPercent: deriveMassDeviationPercent(liveMassKg, suggestedMassKg),
      massKgFieldName: `ingredientBins.${index}.massKg` as const,
      storageLocationFieldName: `ingredientBins.${index}.storageLocationId` as const,
    };
  });

  return {
    rows,
    isLoading,
    facilityId: facilityId ?? "",
    control,
  };
}
