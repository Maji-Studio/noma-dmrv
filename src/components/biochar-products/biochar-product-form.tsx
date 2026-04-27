/**
 * BiocharProductForm component
 * Redesigned form with visual bin transfer flow
 */
"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { nullableNumericValue } from "@/lib/form-utils";
import { toDateInputValue } from "@/lib/date-utils";
import { deriveMassDryKgWithAddedWater } from "@/lib/calculations/mass-dry";

import { useForm, Controller, useWatch, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, EntitySelect, SectionLabel } from "@/components/forms";
import { useEntityById } from "@/hooks/use-entities";
import { useFormulation } from "@/hooks/use-formulations";
import { Button } from "@/components/ui";
import {
  biocharProductFormSchema,
  type BiocharProductFormData,
  type IngredientBin,
} from "@/schemas/biochar-products";
import { INGREDIENT_TYPE_LABELS } from "@/schemas/formulations";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import { getProductionRunBiocharPreviewFn } from "@/fn/production-runs";

// ============================================
// Transfer Flow Visual
// ============================================

function TransferFlowPreview({
  sourceBinCode,
  availableKg,
  sourceMassKg,
  destinationMassKg,
  destinationBinLabel,
}: {
  sourceBinCode: string | null;
  availableKg: number | null;
  sourceMassKg: number | null;
  destinationMassKg: number | null;
  destinationBinLabel: string | null;
}) {
  const hasSource = sourceBinCode && availableKg !== null;
  const hasMass = sourceMassKg !== null && sourceMassKg > 0;
  const hasDestination = !!destinationBinLabel;

  if (!hasSource && !hasMass && !hasDestination) return null;

  return (
    <div className="flex items-stretch gap-0 text-center">
      {/* Source bin */}
      <div
        className={`flex-1 border px-12 py-10 flex flex-col justify-center transition-colors ${
          hasSource
            ? "border-[var(--color-border-primary)] bg-[var(--color-bg-tertiary)]"
            : "border-dashed border-[var(--color-border-tertiary)] bg-transparent"
        }`}
      >
        <span className="body-caption text-[var(--color-text-tertiary)] uppercase tracking-[0.06em]">
          Source
        </span>
        {hasSource ? (
          <>
            <span className="body-small font-medium text-[var(--color-text-primary)] mt-2">
              {sourceBinCode}
            </span>
            <span className="body-caption text-[var(--color-text-secondary)] mt-1">
              {availableKg.toLocaleString()} kg available
            </span>
            {hasMass && (
              <span className="body-caption font-medium text-[var(--clr-orange)] mt-1">
                &minus;{sourceMassKg.toLocaleString()} kg
              </span>
            )}
          </>
        ) : (
          <span className="body-small text-[var(--color-text-quaternary)] mt-2">
            Select a run
          </span>
        )}
      </div>

      {/* Arrow + mass */}
      <div className="flex flex-col items-center justify-center px-8 min-w-[80px]">
        <svg width="48" height="16" viewBox="0 0 48 16" fill="none" className="text-[var(--color-text-tertiary)]">
          <path d="M0 8H40M40 8L34 3M40 8L34 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {hasMass ? (
          <span className="body-caption font-medium text-[var(--color-text-primary)] mt-2">
            {sourceMassKg.toLocaleString()} kg
          </span>
        ) : (
          <span className="body-caption text-[var(--color-text-quaternary)] mt-2">
            — kg
          </span>
        )}
      </div>

      {/* Destination bin */}
      <div
        className={`flex-1 border px-12 py-10 flex flex-col justify-center transition-colors ${
          hasDestination
            ? "border-[var(--color-border-primary)] bg-[var(--color-bg-tertiary)]"
            : "border-dashed border-[var(--color-border-tertiary)] bg-transparent"
        }`}
      >
        <span className="body-caption text-[var(--color-text-tertiary)] uppercase tracking-[0.06em]">
          Destination
        </span>
        {hasDestination ? (
          <>
            <span className="body-small font-medium text-[var(--color-text-primary)] mt-2">
              {destinationBinLabel}
            </span>
            {destinationMassKg !== null && destinationMassKg > 0 && (
              <span className="body-caption font-medium text-green-600 mt-1">
                +{destinationMassKg.toLocaleString()} kg
              </span>
            )}
          </>
        ) : (
          <span className="body-small text-[var(--color-text-quaternary)] mt-2">
            Select a bin
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================
// Ingredient Bin Field
// ============================================

function IngredientBinField({
  index,
  ingredientName,
  ingredientType,
  removalKg,
  control,
  isSubmitting,
  facilityId,
}: {
  index: number;
  ingredientName: string;
  ingredientType: string;
  removalKg: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  isSubmitting: boolean;
  facilityId: string;
}) {
  const typeLabel = INGREDIENT_TYPE_LABELS[ingredientType as keyof typeof INGREDIENT_TYPE_LABELS] ?? ingredientType;

  const formatLabel = (entity: { name: string; subtitle?: string }) => {
    const parts = [entity.name];
    if (entity.subtitle) parts.push(entity.subtitle.replace("Ingredient Bin · ", ""));
    if (removalKg) parts.push(`(−${removalKg.toFixed(0)} kg)`);
    return parts.join(" · ");
  };

  return (
    <FormField
      id={`ingredientBins.${index}.storageLocationId`}
      label={ingredientName}
      helperText={typeLabel}
    >
      <Controller
        name={`ingredientBins.${index}.storageLocationId` as const}
        control={control}
        render={({ field }) => (
          <EntitySelect
            entityType="storageLocation"
            value={field.value || ""}
            onChange={field.onChange}
            placeholder="Select an ingredient bin..."
            disabled={isSubmitting}
            filterBy={{
              ...(facilityId ? { facilityId } : {}),
              type: "ingredient_bin",
            }}
            formatSelectedLabel={formatLabel}
          />
        )}
      />
    </FormField>
  );
}

// ============================================
// Component
// ============================================

interface BiocharProductFormProps {
  product?: BiocharProductWithRelations;
  onSubmit: (data: BiocharProductFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
}

export function BiocharProductForm({
  product,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: BiocharProductFormProps) {
  const isEditMode = !!product;
  const { facilityId: contextFacilityId } = useFacilityContext();

  const existingIngredientBins =
    (product?.composition as { ingredients?: IngredientBin[] } | null)?.ingredients ?? [];

  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm({
    resolver: zodResolver(biocharProductFormSchema),
    defaultValues: {
      facilityId: product?.facility?.id ?? contextFacilityId ?? "",
      formulationId: product?.formulation?.id ?? "",
      productionDate: toDateInputValue(product?.productionDate),
      linkedProductionRunId: product?.linkedProductionRun?.id ?? product?.linkedProductionRunId ?? "",
      storageLocationId: product?.storageLocation?.id ?? "",
      status: product?.status ?? "testing",
      massKg: product?.massKg ?? null,
      moistureContentPercent: product?.moistureContentPercent ?? null,
      densityKgM3: product?.densityKgM3 ?? null,
      waterAddedKg: product?.waterAddedKg ?? null,
      ingredientBins: existingIngredientBins,
    },
  });

  const selectedFacilityId = useWatch({ control, name: "facilityId" }) || contextFacilityId || "";
  const linkedProductionRunId = useWatch({ control, name: "linkedProductionRunId" });
  const storageLocationId = useWatch({ control, name: "storageLocationId" });
  const selectedFormulationId = useWatch({ control, name: "formulationId" });
  const watchedMassKg = useWatch({ control, name: "massKg" });
  const watchedMoisture = useWatch({ control, name: "moistureContentPercent" });
  const watchedWaterAddedKg = useWatch({ control, name: "waterAddedKg" });

  const { fields: ingredientBinFields, replace: replaceIngredientBins } = useFieldArray({
    control,
    name: "ingredientBins",
  });

  const { data: selectedFormulation } = useFormulation(selectedFormulationId ?? "", !!selectedFormulationId);

  const syncedFormulationIdRef = useRef(product?.formulation?.id ?? "");
  useEffect(() => {
    if (!selectedFormulation?.ingredients) return;
    if (selectedFormulation.id === syncedFormulationIdRef.current) return;
    syncedFormulationIdRef.current = selectedFormulation.id;

    const newBins = selectedFormulation.ingredients.map((ing) => {
      const existing = existingIngredientBins.find(
        (eb) => eb.formulationIngredientId === ing.id
      );
      return {
        formulationIngredientId: ing.id,
        ingredientName: ing.name,
        ingredientType: ing.ingredientType,
        ratio: ing.ratio ?? null,
        storageLocationId: existing?.storageLocationId ?? null,
        massKg: existing?.massKg ?? null,
      };
    });
    replaceIngredientBins(newBins);
  }, [selectedFormulation, existingIngredientBins, replaceIngredientBins]);

  // Fetch linked run preview for transfer flow
  const { data: linkedRunPreview } = useQuery({
    queryKey: ["production-run-biochar-preview", linkedProductionRunId],
    queryFn: async () => {
      if (!linkedProductionRunId) return null;
      const result = await getProductionRunBiocharPreviewFn(linkedProductionRunId);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    enabled: !!linkedProductionRunId,
    staleTime: 60_000,
  });

  // Fetch selected storage location name for the preview
  const { data: selectedStorageLocation } = useEntityById("storageLocation", storageLocationId || undefined);

  // Sync facilityId from context when creating
  useEffect(() => {
    if (!product && contextFacilityId && !getValues("facilityId")) {
      setValue("facilityId", contextFacilityId);
    }
  }, [product, contextFacilityId, getValues, setValue]);

  // Clear dependent fields when facility changes
  const previousSelectedFacilityRef = useRef(selectedFacilityId);
  useEffect(() => {
    if (selectedFacilityId !== previousSelectedFacilityRef.current) {
      setValue("linkedProductionRunId", "");
      setValue("storageLocationId", "");
      previousSelectedFacilityRef.current = selectedFacilityId;
    }
  }, [selectedFacilityId, setValue]);

  // Auto-fill mass from linked production run
  useEffect(() => {
    if (product || dirtyFields.massKg || linkedRunPreview?.biocharOutputKg == null) return;

    const currentMass = getValues("massKg");
    if (currentMass === undefined || currentMass === null) {
      setValue("massKg", linkedRunPreview.biocharOutputKg, {
        shouldDirty: false,
        shouldValidate: false,
      });
    }
  }, [dirtyFields.massKg, getValues, linkedRunPreview, product, setValue]);

  const defaultSubmitLabel = isEditMode ? "Update Product" : "Create Product";

  const handleFormSubmit = handleSubmit((data) => {
    return onSubmit(data as BiocharProductFormData);
  });

  // Derive preview values
  const massKgNum = typeof watchedMassKg === "number" ? watchedMassKg : null;
  const moistureNum = typeof watchedMoisture === "number" ? watchedMoisture : null;
  const waterAddedKgNum = typeof watchedWaterAddedKg === "number" ? watchedWaterAddedKg : null;
  const effectiveWetMassKg =
    massKgNum !== null && (waterAddedKgNum === null || waterAddedKgNum >= 0)
      ? massKgNum + (waterAddedKgNum ?? 0)
      : null;
  const dryMassKg =
    massKgNum !== null &&
    moistureNum !== null &&
    moistureNum >= 0 &&
    moistureNum <= 100 &&
    (waterAddedKgNum === null || waterAddedKgNum >= 0)
      ? deriveMassDryKgWithAddedWater(massKgNum, moistureNum, waterAddedKgNum)
      : null;
  const hasWaterAdded = waterAddedKgNum != null && waterAddedKgNum > 0;
  const finalMoisturePercent =
    hasWaterAdded && massKgNum !== null && moistureNum !== null && effectiveWetMassKg !== null && effectiveWetMassKg > 0
      ? ((massKgNum * moistureNum / 100 + waterAddedKgNum) / effectiveWetMassKg) * 100
      : null;

  return (
    <form onSubmit={handleFormSubmit} className="space-y-24">
      {/* Transfer Flow Preview */}
      <div className="space-y-12">
        <SectionLabel>Transfer Preview</SectionLabel>
        <TransferFlowPreview
          sourceBinCode={linkedRunPreview?.biocharStorageLocationCode ?? null}
          availableKg={linkedRunPreview?.biocharOutputKg ?? null}
          sourceMassKg={massKgNum}
          destinationMassKg={effectiveWetMassKg}
          destinationBinLabel={
            selectedStorageLocation?.name
              ?? ((storageLocationId == null || storageLocationId === "")
                ? product?.storageLocation?.name ?? null
                : null)
              ?? null
          }
        />
      </div>

      {/* Source: Production Run */}
      <div className="space-y-16 pt-20 border-t border-[var(--color-border-tertiary)]">
        <SectionLabel>Source</SectionLabel>

        <FormField
          id="linkedProductionRunId"
          label="Production Run"
          error={errors.linkedProductionRunId?.message}
          helperText="Which production run produced this biochar?"
          required
        >
          <Controller
            name="linkedProductionRunId"
            control={control}
            render={({ field, fieldState }) => (
              <EntitySelect
                entityType="productionRun"
                value={field.value || ""}
                onChange={field.onChange}
                placeholder="Select a production run..."
                disabled={isSubmitting}
                error={!!fieldState.error}
                filterBy={selectedFacilityId ? { facilityId: selectedFacilityId, status: "complete" } : { status: "complete" }}
              />
            )}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="massKg"
            label="Wet Mass (kg)"
            error={errors.massKg?.message}
            required
            helperText={
              linkedRunPreview?.biocharOutputKg !== null && linkedRunPreview?.biocharOutputKg !== undefined
                ? `${linkedRunPreview.biocharOutputKg.toLocaleString()} kg from run`
                : undefined
            }
          >
            <FormInput
              id="massKg"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g., 500"
              disabled={isSubmitting}
              error={!!errors.massKg}
              {...register("massKg", { setValueAs: nullableNumericValue })}
            />
          </FormField>

          <FormField
            id="moistureContentPercent"
            label="Moisture Content (%)"
            error={errors.moistureContentPercent?.message}
            helperText="Typically 1-2% for biochar"
            required
          >
            <FormInput
              id="moistureContentPercent"
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="e.g., 2"
              disabled={isSubmitting}
              error={!!errors.moistureContentPercent}
              {...register("moistureContentPercent", { setValueAs: nullableNumericValue })}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="waterAddedKg"
            label="Water Added (kg)"
            error={errors.waterAddedKg?.message}
            helperText="Water added to reach target moisture"
            required
          >
            <FormInput
              id="waterAddedKg"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g., 50"
              disabled={isSubmitting}
              error={!!errors.waterAddedKg}
              {...register("waterAddedKg", { setValueAs: nullableNumericValue })}
            />
          </FormField>

          <FormField
            id="densityKgM3"
            label="Density (kg/m3)"
            error={errors.densityKgM3?.message}
          >
            <FormInput
              id="densityKgM3"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g., 350"
              disabled={isSubmitting}
              error={!!errors.densityKgM3}
              {...register("densityKgM3", { setValueAs: nullableNumericValue })}
            />
          </FormField>
        </div>

        {/* Dry mass preview */}
        {dryMassKg !== null && (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border border-[var(--color-border-tertiary)] bg-[var(--color-bg-tertiary)] px-16 py-12">
            <span className="body-small text-[var(--color-text-tertiary)]">Dry Mass</span>
            <span className="body-medium font-medium text-[var(--color-text-primary)]">
              {dryMassKg.toFixed(2)} kg
            </span>
            {hasWaterAdded && effectiveWetMassKg !== null && (
              <>
                <span className="text-[var(--color-text-quaternary)]">&middot;</span>
                <span className="body-small text-[var(--color-text-tertiary)]">Effective wet mass</span>
                <span className="body-small font-medium text-[var(--color-text-primary)]">
                  {effectiveWetMassKg.toFixed(2)} kg
                </span>
              </>
            )}
            {hasWaterAdded && finalMoisturePercent !== null && (
              <>
                <span className="text-[var(--color-text-quaternary)]">&middot;</span>
                <span className="body-small text-[var(--color-text-tertiary)]">Final moisture</span>
                <span className="body-small font-medium text-[var(--color-text-primary)]">
                  {finalMoisturePercent.toFixed(2)}%
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Destination + Product Details */}
      <div className="space-y-16 pt-20 border-t border-[var(--color-border-tertiary)]">
        <SectionLabel>Destination & Product</SectionLabel>

        <FormField
          id="storageLocationId"
          label="Product Bin"
          error={errors.storageLocationId?.message}
          helperText="Where will the finished product be stored?"
          required
        >
          <Controller
            name="storageLocationId"
            control={control}
            render={({ field, fieldState }) => (
              <EntitySelect
                entityType="storageLocation"
                value={field.value || ""}
                onChange={field.onChange}
                placeholder="Select a product bin..."
                disabled={isSubmitting}
                error={!!fieldState.error}
                filterBy={{
                  ...(selectedFacilityId ? { facilityId: selectedFacilityId } : {}),
                  type: "product_bin",
                }}
              />
            )}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-x-16 gap-y-16">
          <FormField id="formulationId" label="Formulation" error={errors.formulationId?.message} required>
            <Controller
              name="formulationId"
              control={control}
              render={({ field, fieldState }) => (
                <EntitySelect
                  entityType="formulation"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select a formulation"
                  disabled={isSubmitting}
                  error={!!fieldState.error}
                  autoSelectSingle
                />
              )}
            />
          </FormField>

          <FormField id="productionDate" label="Production Date" error={errors.productionDate?.message}>
            <FormInput
              id="productionDate"
              type="date"
              disabled={isSubmitting}
              error={!!errors.productionDate}
              {...register("productionDate")}
            />
          </FormField>
        </div>
      </div>

      {/* Ingredient Bins */}
      {ingredientBinFields.length > 0 && (
        <div className="space-y-16 pt-20 border-t border-[var(--color-border-tertiary)]">
          <SectionLabel>Ingredient Bins</SectionLabel>

          {ingredientBinFields.map((field, index) => {
            const ingredientRatio = field.ratio ?? 0;
            const productMassKg = typeof watchedMassKg === "number" ? watchedMassKg : 0;
            const biocharRatio = selectedFormulation?.biocharRatio;
            const removalKg =
              biocharRatio && biocharRatio > 0 && ingredientRatio > 0 && productMassKg > 0
                ? (productMassKg / biocharRatio) * ingredientRatio
                : null;

            return (
              <IngredientBinField
                key={field.id}
                index={index}
                ingredientName={field.ingredientName}
                ingredientType={field.ingredientType}
                removalKg={removalKg}
                control={control}
                isSubmitting={isSubmitting}
                facilityId={selectedFacilityId}
              />
            );
          })}
        </div>
      )}

      {/* Form Actions */}
      <div className="flex items-center justify-end gap-16 pt-20 border-t border-[var(--color-border-secondary)]">
        {onCancel && (
          <Button type="button" variant="default" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : (submitLabel ?? defaultSubmitLabel)}
        </Button>
      </div>
    </form>
  );
}
