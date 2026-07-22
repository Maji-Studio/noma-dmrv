/**
 * BiocharProductForm component
 * Redesigned form with visual bin transfer flow
 */
"use client";

import { useEffect, useId, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { nullableNumericValue } from "@/lib/form-utils";

import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FactoryIcon, PackageIcon, FlowArrowIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, EntitySelect, FormSection, FormSpine, FormActions, SectionLabel, DryMassInput } from "@/components/forms";
import {
  StorageLocationQuickAddDialog,
  useQuickAddDialog,
} from "@/components/forms/entity-select";
import { useEntityById } from "@/hooks/use-entities";
import {
  biocharProductFormSchema,
  PURE_PRODUCT_BIN_FILTER,
  type BiocharProductFormData,
} from "@/schemas/biochar-products";
import type { StorageLocationType } from "@/schemas/storage-locations";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import { getProductionRunBiocharPreviewFn } from "@/fn/production-runs";
import {
  fromCompositionJsonb,
  useBiocharComposition,
} from "@/lib/biochar-composition";
import { IngredientBinRows } from "./ingredient-bin-rows";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";
import Link from "next/link";

const PRODUCT_BIN_QUICK_ADD_TYPES = ["product_bin"] as const satisfies readonly StorageLocationType[];
const SET_VALUE_OPTS = { shouldDirty: true, shouldTouch: true, shouldValidate: true } as const;

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
// Component
// ============================================

interface BiocharProductFormProps {
  product?: BiocharProductWithRelations;
  onSubmit: (data: BiocharProductFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  /**
   * Extension content (e.g. transport-legs editor) rendered between the form
   * fields and the CTA row — outside the `<form>` element, so it may contain
   * its own forms. Nothing ever renders after the CTA.
   */
  children?: React.ReactNode;
  focusTarget?: EntityFocusTarget | null;
}

export function BiocharProductForm({
  product,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  children,
  focusTarget,
}: BiocharProductFormProps) {
  const formId = useId();
  const isEditMode = !!product;
  const { facilityId: contextFacilityId } = useFacilityContext();
  const storageLocationDialog = useQuickAddDialog();

  const form = useForm({
    resolver: zodResolver(biocharProductFormSchema),
    // onTouched so spine markers can flag errors on blur, not only on submit.
    mode: "onTouched",
    defaultValues: {
      facilityId: product?.facility?.id ?? contextFacilityId ?? "",
      formulationId: product?.formulation?.id ?? "",
      linkedProductionRunId: product?.linkedProductionRun?.id ?? product?.linkedProductionRunId ?? "",
      storageLocationId: product?.storageLocation?.id ?? "",
      status: product?.status ?? "testing",
      massKg: product?.massKg ?? null,
      moistureContentPercent: product?.moistureContentPercent ?? null,
      densityKgM3: product?.densityKgM3 ?? null,
      waterAddedKg: product?.waterAddedKg ?? null,
      ingredientBins: fromCompositionJsonb(product?.composition),
    },
  });
  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    formState: { errors, dirtyFields },
  } = form;

  const selectedFacilityId = useWatch({ control, name: "facilityId" }) || contextFacilityId || "";
  const linkedProductionRunId = useWatch({ control, name: "linkedProductionRunId" });
  const storageLocationId = useWatch({ control, name: "storageLocationId" });
  const selectedFormulationId = useWatch({ control, name: "formulationId" });
  const watchedMassKg = useWatch({ control, name: "massKg" });
  const watchedMoisture = useWatch({ control, name: "moistureContentPercent" });
  const watchedWaterAddedKg = useWatch({ control, name: "waterAddedKg" });

  const massKgNumForComposition = typeof watchedMassKg === "number" ? watchedMassKg : null;
  const composition = useBiocharComposition(form, {
    formulationId: selectedFormulationId,
    facilityId: selectedFacilityId,
    productMassKg: massKgNumForComposition,
  });

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

  // Clear dependent fields when facility changes (the composition hook owns
  // the per-row ingredient-bin clearing).
  const previousSelectedFacilityRef = useRef(selectedFacilityId);
  useEffect(() => {
    if (selectedFacilityId !== previousSelectedFacilityRef.current) {
      setValue("linkedProductionRunId", "");
      setValue("storageLocationId", "");
      previousSelectedFacilityRef.current = selectedFacilityId;
    }
  }, [selectedFacilityId, setValue]);

  // Clear the destination bin when the formulation changes — a product bin is
  // reserved for a single formulation, so a previously chosen bin may no longer
  // be valid for the new formulation (or for pure biochar).
  const previousFormulationIdRef = useRef(selectedFormulationId);
  useEffect(() => {
    if (selectedFormulationId !== previousFormulationIdRef.current) {
      setValue("storageLocationId", "");
      previousFormulationIdRef.current = selectedFormulationId;
    }
  }, [selectedFormulationId, setValue]);

  // Prefill mass from the linked production run (create mode only). Re-applies
  // when a different run is selected — previously the mass kept the prior run's
  // value, leaving the product inconsistent with its linked run (#46) — but
  // never overwrites a field the user edited themselves. The production date is
  // not prefilled here: it is derived server-side from the linked run (the
  // biochar's production date), so it has no editable field on the form.
  const lastPrefilledRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (product) return;
    if (!linkedProductionRunId || !linkedRunPreview) return;
    if (lastPrefilledRunIdRef.current === linkedProductionRunId) return;
    lastPrefilledRunIdRef.current = linkedProductionRunId;

    if (!dirtyFields.massKg && linkedRunPreview.biocharOutputKg != null) {
      setValue("massKg", linkedRunPreview.biocharOutputKg, {
        shouldDirty: false,
        shouldValidate: false,
      });
    }
  }, [
    dirtyFields.massKg,
    linkedProductionRunId,
    linkedRunPreview,
    product,
    setValue,
  ]);

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
  const hasWaterAdded = waterAddedKgNum != null && waterAddedKgNum > 0;
  const finalMoisturePercent =
    hasWaterAdded && massKgNum !== null && moistureNum !== null && effectiveWetMassKg !== null && effectiveWetMassKg > 0
      ? ((massKgNum * moistureNum / 100 + waterAddedKgNum) / effectiveWetMassKg) * 100
      : null;

  return (
    <div className="space-y-20">
      {focusTarget && (
        <ActionableFocusTarget
          target={focusTarget}
          activeTarget={focusTarget}
          actionLabel="Update the delivery that supplies this derived transport leg"
        >
          <p className="body-small text-[var(--color-text-secondary)]">
            Product transport is derived from its delivered deliveries. Mark
            the contributing delivery distance source as Document and attach
            supporting evidence there.
          </p>
          <Link
            href={
              selectedFacilityId
                ? `/deliveries?facility=${encodeURIComponent(selectedFacilityId)}`
                : "/deliveries"
            }
            className="label-micro mt-8 inline-flex text-[var(--color-interaction)]"
          >
            Open deliveries
          </Link>
        </ActionableFocusTarget>
      )}
      <form id={formId} onSubmit={handleFormSubmit} className="space-y-20">
      {/* Transfer Preview — a derived recap of the transfer, not a data-entry
          step, so it sits above the numbered spine and only when it has data. */}
      {(linkedRunPreview || selectedStorageLocation || massKgNum != null) && (
        <div className="space-y-12">
          <SectionLabel icon={<FlowArrowIcon size={14} weight="bold" />}>
            Transfer Preview
          </SectionLabel>
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
      )}

      <FormSpine control={control}>
      {/* Source: Production Run */}
      <FormSection
        title="Source"
        icon={<FactoryIcon size={14} weight="bold" />}
        fields={["linkedProductionRunId", "massKg", "moistureContentPercent", "waterAddedKg", "densityKgM3"]}
      >
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
                emptyHint={{
                  message:
                    "No completed production runs yet — only runs marked Complete can become a product. Finish the run first.",
                  href: selectedFacilityId
                    ? `/production-runs?facility=${encodeURIComponent(selectedFacilityId)}`
                    : "/production-runs",
                  linkLabel: "Open production runs",
                }}
              />
            )}
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-16">
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
            <DryMassInput
              id="massKg"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g., 500"
              disabled={isSubmitting}
              error={!!errors.massKg}
              wetMassKg={watchedMassKg}
              moisturePercent={watchedMoisture}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-16">
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

        {/* Dry mass is surfaced inline under Wet Mass (DryMassInput). When water
            is added, show what it changes — effective wet mass and final moisture. */}
        {hasWaterAdded && effectiveWetMassKg !== null && (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 border border-[var(--color-border-tertiary)] bg-[var(--color-bg-tertiary)] px-16 py-12">
            <span className="body-small text-[var(--color-text-tertiary)]">Effective wet mass</span>
            <span className="body-medium font-medium text-[var(--color-text-primary)]">
              {effectiveWetMassKg.toFixed(2)} kg
            </span>
            {finalMoisturePercent !== null && (
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
      </FormSection>

      {/* Destination + Product Details */}
      <FormSection
        title="Destination & Product"
        icon={<PackageIcon size={14} weight="bold" />}
        fields={["formulationId", "storageLocationId"]}
      >

        {/* Formulation drives ingredient-bin rows and the destination bin filter.
            Leaving it empty produces a pure-biochar product. */}
        <FormField
          id="formulationId"
          label="Formulation"
          error={errors.formulationId?.message}
          helperText="Leave empty for a pure-biochar product (no amendment blend)."
        >
          <Controller
            name="formulationId"
            control={control}
            render={({ field, fieldState }) => (
              <EntitySelect
                entityType="formulation"
                value={field.value || ""}
                onChange={field.onChange}
                placeholder="Select a formulation (or leave empty for pure biochar)"
                disabled={isSubmitting}
                error={!!fieldState.error}
              />
            )}
          />
        </FormField>

        {/* Blend ingredients — each drawn from the feedstock bin holding it */}
        <IngredientBinRows composition={composition} isSubmitting={isSubmitting} />

        <FormField
          id="storageLocationId"
          label="Product Bin"
          error={errors.storageLocationId?.message}
          helperText={
            selectedFormulationId
              ? "Bins for this formulation, or unassigned bins (claimed on first use)."
              : "Pure-biochar or unassigned bins."
          }
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
                  formulationId: selectedFormulationId || PURE_PRODUCT_BIN_FILTER,
                }}
                allowCreate
                createLabel="Add New Bin"
                onCreateNew={() => storageLocationDialog.open()}
              />
            )}
          />
        </FormField>
      </FormSection>
      </FormSpine>

      </form>

      {selectedFacilityId && (
        <StorageLocationQuickAddDialog
          isOpen={storageLocationDialog.isOpen}
          onClose={storageLocationDialog.close}
          onSuccess={(entity) => {
            setValue("storageLocationId", entity.id, SET_VALUE_OPTS);
            storageLocationDialog.close();
          }}
          defaultBinType="product_bin"
          allowedTypes={PRODUCT_BIN_QUICK_ADD_TYPES}
          defaultFormulationId={selectedFormulationId || undefined}
          facilityId={selectedFacilityId}
        />
      )}

      {/* Extension content (e.g. transport legs) — always before the CTA */}
      {children}

      <FormActions
        formId={formId}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </div>
  );
}
