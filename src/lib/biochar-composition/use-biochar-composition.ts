"use client";

/**
 * useBiocharComposition
 *
 * Caller-facing React hook that owns the form-side composition concerns:
 *   - the `ingredientBins` field array,
 *   - the formulation fetch (via `useFormulation`),
 *   - the formulation-change sync effect (preserves user-entered fields),
 *   - the facility-change cascade (clears each row's `storageLocationId`),
 *   - the recipe suggestion and deviation per row.
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

export interface UseBiocharCompositionArgs {
  formulationId: string | null | undefined;
  facilityId: string | null | undefined;
  productMassKg: number | null | undefined;
  /** Persisted source allocations keep their exact saved composition snapshot. */
  allocationFrozen: boolean;
}

export interface UseBiocharCompositionResult {
  rows: CompositionRow[];
  isLoading: boolean;
  facilityId: string;
  biocharRatio: number | null;
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
  const {
    formulationId,
    facilityId,
    productMassKg,
    allocationFrozen,
  } = args;

  const control = form.control as Control<FieldValues>;
  const { fields, replace } = useFieldArray({ control, name: "ingredientBins" });
  const ingredientFields = fields as unknown as IngredientField[];

  const { data: formulation, isLoading } = useFormulation(
    formulationId ?? "",
    !!formulationId,
  );

  // Sync rows whenever an unfrozen formulation's ingredient list arrives.
  // Products with persisted source allocations retain the exact saved rows and
  // metadata because those facts are part of the immutable allocation.
  const syncedFormulationIdRef = useRef("");
  useEffect(() => {
    if (allocationFrozen) return;

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
  }, [allocationFrozen, formulationId, formulation, form, replace]);

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

  const productMass = typeof productMassKg === "number" ? productMassKg : null;

  // Live values (not the field-array snapshot) so the deviation hint tracks
  // the user's typing.
  const liveBins = useWatch({ control, name: "ingredientBins" }) as
    | IngredientBin[]
    | undefined;

  const rows: CompositionRow[] = ingredientFields.map((field, index) => {
    const suggestedMassKg = deriveSuggestedIngredientMassKg(
      productMass,
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
    biocharRatio: formulation?.biocharRatio ?? null,
    control,
  };
}
