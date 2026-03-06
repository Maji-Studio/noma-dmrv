/**
 * BiocharProductForm component
 * Redesigned form with visual bin transfer flow
 */
"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { nullableNumericValue } from "@/lib/form-utils";
import { formatLocalDate } from "@/lib/date-utils";

import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, EntitySelect, SectionLabel } from "@/components/forms";
import { useEntityById } from "@/hooks/use-entities";
import { Button } from "@/components/ui";
import {
  biocharProductFormSchema,
  type BiocharProductFormData,
} from "@/schemas/biochar-products";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import { getProductionRunBiocharPreviewFn } from "@/fn/production-runs";

// ============================================
// Transfer Flow Visual
// ============================================

function TransferFlowPreview({
  sourceBinCode,
  availableKg,
  massKg,
  destinationBinLabel,
}: {
  sourceBinCode: string | null;
  availableKg: number | null;
  massKg: number | null;
  destinationBinLabel: string | null;
}) {
  const hasSource = sourceBinCode && availableKg !== null;
  const hasMass = massKg !== null && massKg > 0;
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
            {massKg.toLocaleString()} kg
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
          <span className="body-small font-medium text-[var(--color-text-primary)] mt-2">
            {destinationBinLabel}
          </span>
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

  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(biocharProductFormSchema),
    defaultValues: {
      facilityId: product?.facility?.id ?? contextFacilityId ?? "",
      formulationId: product?.formulation?.id ?? "",
      productionDate: product?.productionDate ?? formatLocalDate(new Date()),
      linkedProductionRunId: product?.linkedProductionRun?.id ?? "",
      storageLocationId: product?.storageLocation?.id ?? "",
      status: product?.status ?? "testing",
      massKg: product?.massKg ?? null,
      densityKgM3: product?.densityKgM3 ?? null,
    },
  });

  const selectedFacilityId = useWatch({ control, name: "facilityId" }) || contextFacilityId || "";
  const linkedProductionRunId = useWatch({ control, name: "linkedProductionRunId" });
  const storageLocationId = useWatch({ control, name: "storageLocationId" });
  const watchedMassKg = useWatch({ control, name: "massKg" });

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
    if (!linkedRunPreview || linkedRunPreview.biocharOutputKg === null) return;
    const currentMass = getValues("massKg");
    const shouldPrefillMass = currentMass === undefined || currentMass === null;
    if (shouldPrefillMass) {
      setValue("massKg", linkedRunPreview.biocharOutputKg, {
        shouldDirty: !shouldPrefillMass,
        shouldValidate: true,
      });
    }
  }, [getValues, linkedRunPreview, setValue]);

  const defaultSubmitLabel = isEditMode ? "Update Product" : "Create Product";

  const handleFormSubmit = handleSubmit((data) => {
    return onSubmit(data as BiocharProductFormData);
  });

  // Derive preview values
  const massKgNum = typeof watchedMassKg === "number" ? watchedMassKg : null;

  return (
    <form onSubmit={handleFormSubmit} className="space-y-24">
      {/* Transfer Flow Preview */}
      <div className="space-y-12">
        <SectionLabel>Transfer Preview</SectionLabel>
        <TransferFlowPreview
          sourceBinCode={linkedRunPreview?.biocharStorageLocationCode ?? null}
          availableKg={linkedRunPreview?.biocharOutputKg ?? null}
          massKg={massKgNum}
          destinationBinLabel={
            selectedStorageLocation?.name
              ?? product?.storageLocation?.name
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
                filterBy={selectedFacilityId ? { facilityId: selectedFacilityId } : undefined}
              />
            )}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="massKg"
            label="Mass (kg)"
            error={errors.massKg?.message}
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
      </div>

      {/* Destination + Product Details */}
      <div className="space-y-16 pt-20 border-t border-[var(--color-border-tertiary)]">
        <SectionLabel>Destination & Product</SectionLabel>

        <FormField
          id="storageLocationId"
          label="Product Bin"
          error={errors.storageLocationId?.message}
          helperText="Where will the finished product be stored?"
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
