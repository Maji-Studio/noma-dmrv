/**
 * BiocharProductForm component
 * Redesigned form with visual bin transfer flow
 */
"use client";

import { useEffect, useId, useRef } from "react";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { nullableNumericValue } from "@/lib/form-utils";

import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FactoryIcon, PackageIcon, FlowArrowIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, EntitySelect, FormSection, FormSpine, FormActions, SectionLabel, MassMoistureFields, StockReconciliationLink } from "@/components/forms";
import {
  formatMoisturePercent,
  splitWetMassAfterAddedWater,
} from "@/lib/mass-moisture";
import { formatMassKg } from "@/lib/format-utils";
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
import {
  MASS_KG_INPUT_STEP,
} from "@/schemas/helpers";
import type { StorageLocationType } from "@/schemas/storage-locations";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import {
  deriveSourceBiocharMassKg,
  fromCompositionJsonb,
  SOURCE_BIOCHAR_MASS_ERROR,
  useBiocharComposition,
} from "@/lib/biochar-composition";
import { IngredientBinRows } from "./ingredient-bin-rows";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";
import Link from "next/link";
import {
  BIOCHAR_PRE_WATER_MOISTURE_LABEL,
  BIOCHAR_PRE_WATER_WET_MASS_LABEL,
} from "@/config/product-labels";
import { useStockAvailability } from "@/hooks/use-stock-availability";
import { useInlineStockServerError } from "@/hooks/use-inline-stock-server-error";
import {
  binStockOverdrawInlineMessage,
  binStockOverdrawMessage,
  isStockOverdraw,
} from "@/lib/stock-overdraw";

const PRODUCT_BIN_QUICK_ADD_TYPES = ["product_bin"] as const satisfies readonly StorageLocationType[];
const SET_VALUE_OPTS = { shouldDirty: true, shouldTouch: true, shouldValidate: true } as const;

// ============================================
// Transfer Flow Visual
// ============================================

/**
 * Keep the preview dry-mass first and intentionally terse. The source summary
 * reads as one stock equation: available dry biochar, planned subtraction, and
 * the remaining stock. Wet mass stays in the editable fields below.
 */
export function TransferFlowPreview({
  sourceBinName,
  sourceAvailableWetMassKg,
  sourceAvailableDryMassKg,
  sourceWetMassKg,
  recordedSourceDryMassKg = null,
  destinationDryMassKg,
  destinationBinLabel,
  isEditMode = false,
}: {
  sourceBinName: string | null;
  sourceAvailableWetMassKg: number | null;
  sourceAvailableDryMassKg: number | null;
  sourceWetMassKg: number | null;
  recordedSourceDryMassKg?: number | null;
  destinationDryMassKg: number | null;
  destinationBinLabel: string | null;
  isEditMode?: boolean;
}) {
  const hasSource = !!sourceBinName;
  const hasWetTransfer = sourceWetMassKg !== null && sourceWetMassKg > 0;
  // Creation previews the proportional draw from today's source stock. Edits
  // must use the immutable allocation recorded at creation: today's bin ratio
  // may have changed after later lots or losses, or the bin may be exhausted.
  const proportionalSourceDryMassKg =
    hasWetTransfer &&
    sourceAvailableWetMassKg !== null &&
    sourceAvailableWetMassKg > 0 &&
    sourceAvailableDryMassKg !== null
      ? sourceWetMassKg *
        (sourceAvailableDryMassKg / sourceAvailableWetMassKg)
      : null;
  const sourceDryMassKg = isEditMode
    ? recordedSourceDryMassKg
    : proportionalSourceDryMassKg;
  const hasDryTransfer = sourceDryMassKg !== null && sourceDryMassKg > 0;
  const hasDestination = !!destinationBinLabel;
  // Entity options report today's post-allocation remainder. On edit, add the
  // product's fixed draw back before showing the same before/draw/after equation.
  const sourceDryMassBeforeTransferKg = isEditMode
    ? sourceAvailableDryMassKg !== null && sourceDryMassKg !== null
      ? sourceAvailableDryMassKg + sourceDryMassKg
      : null
    : sourceAvailableDryMassKg;
  const remainingSourceDryMassKg =
    sourceDryMassBeforeTransferKg !== null && sourceDryMassKg !== null
      ? sourceDryMassBeforeTransferKg - sourceDryMassKg
      : null;

  if (!hasSource && !hasWetTransfer && !hasDestination) return null;

  return (
    <div className="grid grid-cols-1 items-stretch gap-6 text-left sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-8">
      {/* Source bin */}
      <div
        role="group"
        aria-label="Source biochar"
        className={`border px-12 py-10 flex flex-col justify-center transition-colors ${
          hasSource
            ? "border-[var(--color-border-primary)] bg-[var(--color-background-medium)]"
            : "border-dashed border-[var(--color-border-tertiary)] bg-transparent"
        }`}
      >
        {hasSource ? (
          <>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Source ·{" "}
              <span className="text-[var(--color-text-secondary)]">
                {sourceBinName}
              </span>
            </p>
            <p className="body-small text-[var(--color-text-primary)] mt-6">
              Dry biochar:{" "}
              <span className="font-medium">
                {formatMassKg(sourceDryMassBeforeTransferKg)}
              </span>
              {hasDryTransfer && (
                <span className="font-medium text-[var(--st-wait)]">
                  {" "}(&minus;{formatMassKg(sourceDryMassKg)})
                </span>
              )}
            </p>
            {remainingSourceDryMassKg !== null ? (
              <p className="body-small text-[var(--color-text-secondary)] mt-2">
                Remaining:{" "}
                <span className="font-medium">
                  {formatMassKg(remainingSourceDryMassKg)}
                </span>
              </p>
            ) : (
              <p className="body-small text-[var(--color-text-tertiary)] mt-2">
                {!hasWetTransfer
                  ? "Add wet mass to calculate the transfer."
                  : isEditMode && recordedSourceDryMassKg === null
                    ? "Recorded source dry allocation is not available."
                    : sourceAvailableDryMassKg === null ||
                        (!isEditMode && sourceAvailableWetMassKg === null)
                    ? "Source dry stock is not available. Reconcile the storage bin."
                    : "Source dry transfer cannot be calculated."}
              </p>
            )}
          </>
        ) : (
          <>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Source
            </span>
            <span className="body-small text-[var(--color-text-tertiary)] mt-2">
              Select a biochar bin
            </span>
          </>
        )}
      </div>

      {/* Direction only: the mass is already stated in the source equation. */}
      <div
        aria-hidden="true"
        className="flex items-center justify-center py-2 sm:px-4 sm:py-0"
      >
        <svg
          width="40"
          height="16"
          viewBox="0 0 48 16"
          fill="none"
          className="rotate-90 text-[var(--color-text-tertiary)] sm:rotate-0"
        >
          <path
            d="M0 8H40M40 8L34 3M40 8L34 13"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Destination bin */}
      <div
        role="group"
        aria-label="Destination bin"
        className={`border px-12 py-10 flex flex-col justify-center transition-colors ${
          hasDestination
            ? "border-[var(--color-border-primary)] bg-[var(--color-background-medium)]"
            : "border-dashed border-[var(--color-border-tertiary)] bg-transparent"
        }`}
      >
        {hasDestination ? (
          <>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Destination ·{" "}
              <span className="text-[var(--color-text-secondary)]">
                {destinationBinLabel}
              </span>
            </p>
            {destinationDryMassKg !== null && destinationDryMassKg > 0 && (
              <span className="body-small text-[var(--color-text-secondary)] mt-6">
                Dry product:{" "}
                <span className="font-medium text-[var(--st-ok)]">
                  +{formatMassKg(destinationDryMassKg)}
                </span>
              </span>
            )}
            {hasWetTransfer && destinationDryMassKg === null && (
              <span className="body-small text-[var(--color-text-tertiary)] mt-6">
                Record moisture to calculate the dry product.
              </span>
            )}
          </>
        ) : (
          <>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Destination
            </span>
            <span className="body-small text-[var(--color-text-tertiary)] mt-2">
              Select a bin
            </span>
          </>
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
  errorMessage?: string;
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
  errorMessage,
  submitLabel,
  children,
  focusTarget,
}: BiocharProductFormProps) {
  const formId = useId();
  const isEditMode = !!product;
  const hasFrozenSourceAllocation = Boolean(
    product?.sourceBiocharStorageLocationId,
  );
  const initialFormulationId =
    product?.formulation?.id ?? product?.formulationId ?? null;
  const { facilityId: contextFacilityId } = useFacilityContext();
  const storageLocationDialog = useQuickAddDialog();

  const form = useForm({
    resolver: zodResolver(biocharProductFormSchema),
    // onTouched so spine markers can flag errors on blur, not only on submit.
    mode: "onTouched",
    defaultValues: {
      facilityId: product?.facility?.id ?? contextFacilityId ?? "",
      formulationId: initialFormulationId ?? "",
      sourceBiocharStorageLocationId:
        product?.sourceBiocharStorageLocation?.id ??
        product?.sourceBiocharStorageLocationId ??
        product?.linkedProductionRun?.biocharStorageLocationId ??
        "",
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
    formState: { errors },
  } = form;

  const selectedFacilityId = useWatch({ control, name: "facilityId" }) || contextFacilityId || "";
  const sourceBiocharStorageLocationId = useWatch({
    control,
    name: "sourceBiocharStorageLocationId",
  });
  const storageLocationId = useWatch({ control, name: "storageLocationId" });
  const selectedFormulationId = useWatch({ control, name: "formulationId" });
  const watchedMassKg = useWatch({ control, name: "massKg" });
  const watchedIngredientBins = useWatch({ control, name: "ingredientBins" });
  const watchedMoisture = useWatch({ control, name: "moistureContentPercent" });
  const watchedWaterAddedKg = useWatch({ control, name: "waterAddedKg" });

  const massKgNumForComposition = typeof watchedMassKg === "number" ? watchedMassKg : null;
  const composition = useBiocharComposition(form, {
    formulationId: selectedFormulationId,
    facilityId: selectedFacilityId,
    productMassKg: massKgNumForComposition,
  });

  const { data: selectedSourceBiocharBin } = useEntityById(
    "storageLocation",
    sourceBiocharStorageLocationId || undefined,
  );

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
      setValue("sourceBiocharStorageLocationId", "");
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

  const defaultSubmitLabel = isEditMode ? "Update Product" : "Create Product";

  const requestedBiocharKg = deriveSourceBiocharMassKg(
    typeof watchedMassKg === "number" ? watchedMassKg : null,
    watchedIngredientBins,
  );
  const { data: biocharAvailability } = useStockAvailability(
    sourceBiocharStorageLocationId
      ? {
          kind: "biocharProduct",
          sourceBiocharStorageLocationId,
          biocharProductId: product?.id,
        }
      : null,
  );
  const biocharStockError =
    requestedBiocharKg !== null && requestedBiocharKg < 0
      ? SOURCE_BIOCHAR_MASS_ERROR
      : requestedBiocharKg !== null &&
          biocharAvailability &&
          biocharAvailability.availableKg !== null &&
          isStockOverdraw(requestedBiocharKg, biocharAvailability.availableKg)
        ? binStockOverdrawInlineMessage(
            "biochar",
            biocharAvailability.availableKg,
          )
        : undefined;
  const massFieldFingerprint = [
    sourceBiocharStorageLocationId,
    selectedFormulationId,
    watchedMassKg,
    ...(watchedIngredientBins ?? []).map((ingredient) => ingredient.massKg),
  ].join(":");
  const routedServerError = useInlineStockServerError(
    errorMessage,
    massFieldFingerprint,
    (message) =>
      message === binStockOverdrawMessage("biochar") ||
      message === SOURCE_BIOCHAR_MASS_ERROR,
  );
  const massKgError =
    errors.massKg?.message ??
    biocharStockError ??
    routedServerError.inlineError;

  const handleFormSubmit = handleSubmit((data) => {
    return onSubmit(data as BiocharProductFormData);
  });

  // Derive preview values
  const massKgNum = typeof watchedMassKg === "number" ? watchedMassKg : null;
  const moistureNum = typeof watchedMoisture === "number" ? watchedMoisture : null;
  const waterAddedKgNum =
    typeof watchedWaterAddedKg === "number" && Number.isFinite(watchedWaterAddedKg)
      ? watchedWaterAddedKg
      : null;
  const effectiveWetMassKg =
    massKgNum !== null && (waterAddedKgNum === null || waterAddedKgNum >= 0)
      ? massKgNum + (waterAddedKgNum ?? 0)
      : null;
  const hasWaterAdded = waterAddedKgNum != null && waterAddedKgNum > 0;
  const finalMassSplit = splitWetMassAfterAddedWater(
    massKgNum,
    moistureNum,
    waterAddedKgNum,
  );

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
      {/* Transfer preview — a derived recap of the transfer, not a data-entry
          step, so it sits above the numbered spine and only when it has data. */}
      {(selectedSourceBiocharBin || selectedStorageLocation || massKgNum != null) && (
        <div className="space-y-12">
          <SectionLabel icon={<FlowArrowIcon size={14} weight="bold" />}>
            Transfer preview
          </SectionLabel>
          <TransferFlowPreview
            sourceBinName={selectedSourceBiocharBin?.name ?? null}
            sourceAvailableWetMassKg={
              selectedSourceBiocharBin?.remainingMass?.wetKg ?? null
            }
            sourceAvailableDryMassKg={
              selectedSourceBiocharBin?.remainingMass?.dryKg ?? null
            }
            sourceWetMassKg={requestedBiocharKg}
            recordedSourceDryMassKg={
              product?.sourceAllocatedDryMassKg ?? null
            }
            destinationDryMassKg={finalMassSplit?.dryKg ?? null}
            destinationBinLabel={
              selectedStorageLocation?.name
                ?? ((storageLocationId == null || storageLocationId === "")
                  ? product?.storageLocation?.name ?? null
                  : null)
                ?? null
            }
            isEditMode={isEditMode}
          />
        </div>
      )}

      <FormSpine control={control}>
      {/* Source biochar bin */}
      <FormSection
        title="Source"
        icon={<FactoryIcon size={14} weight="bold" />}
        fields={["sourceBiocharStorageLocationId", "massKg", "moistureContentPercent", "waterAddedKg", "densityKgM3"]}
      >
        <FormField
          id="sourceBiocharStorageLocationId"
          label="Biochar bin"
          error={errors.sourceBiocharStorageLocationId?.message}
          helperText={
            isEditMode
              ? "The source bin is fixed to preserve the recorded lineage."
              : "Choose the bin that physically holds the biochar. The saved dry draw comes from that source lot's recorded dry mass."
          }
          required
        >
          <Controller
            name="sourceBiocharStorageLocationId"
            control={control}
            render={({ field, fieldState }) => (
              <EntitySelect
                entityType="storageLocation"
                value={field.value || ""}
                onChange={field.onChange}
                placeholder="Select a biochar bin..."
                disabled={isSubmitting || isEditMode}
                error={!!fieldState.error}
                filterBy={{
                  ...(selectedFacilityId
                    ? { facilityId: selectedFacilityId }
                    : {}),
                  type: "biochar_bin",
                }}
                emptyHint={{
                  message:
                    "No biochar bin has traceable biochar available yet.",
                  href: selectedFacilityId
                    ? `/storage-locations?facility=${encodeURIComponent(selectedFacilityId)}`
                    : "/storage-locations",
                  linkLabel: "Open storage bins",
                }}
              />
            )}
          />
        </FormField>

        <MassMoistureFields
          materialLabel="Biochar"
          wetMassKg={watchedMassKg}
          moisturePercent={watchedMoisture}
          splitNote={
            hasWaterAdded && effectiveWetMassKg !== null
              ? `Before added water. With ${formatMassKg(waterAddedKgNum)} added: ${formatMassKg(effectiveWetMassKg)} wet at ${formatMoisturePercent(finalMassSplit?.moisturePercent)} moisture.`
              : undefined
          }
          wet={{
            id: "massKg",
            label: hasWaterAdded
              ? BIOCHAR_PRE_WATER_WET_MASS_LABEL
              : undefined,
            error: massKgError,
            required: true,
            disabled: isSubmitting || isEditMode,
            placeholder: "e.g. 500",
            helperText: isEditMode
              ? "The source draw is fixed to preserve its production-run allocations."
              : undefined,
            registration: register("massKg", { setValueAs: nullableNumericValue }),
          }}
          moisture={{
            id: "moistureContentPercent",
            label: hasWaterAdded
              ? BIOCHAR_PRE_WATER_MOISTURE_LABEL
              : undefined,
            error: errors.moistureContentPercent?.message,
            required: true,
            disabled: isSubmitting,
            placeholder: "e.g. 2",
            helperText: "Typically 1 to 2% for biochar",
            registration: register("moistureContentPercent", { setValueAs: nullableNumericValue }),
          }}
          splitFooter={
            ((biocharStockError !== undefined &&
              biocharStockError !== SOURCE_BIOCHAR_MASS_ERROR) ||
              routedServerError.inlineError ===
                binStockOverdrawMessage("biochar")) && (
              <StockReconciliationLink facilityId={contextFacilityId} />
            )
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-16">
          <FormField
            id="waterAddedKg"
            label="Water added (kg)"
            error={errors.waterAddedKg?.message}
            helperText="Water added to reach target moisture"
            hint="Dry mass is unchanged by added water."
            required
          >
            <FormInput
              id="waterAddedKg"
              type="number"
              step={MASS_KG_INPUT_STEP}
              min="0"
              placeholder="e.g., 50"
              disabled={isSubmitting}
              error={!!errors.waterAddedKg}
              {...register("waterAddedKg", { setValueAs: nullableNumericValue })}
            />
          </FormField>

          <FormField
            id="densityKgM3"
            label="Density (kg/m³)"
            error={errors.densityKgM3?.message}
          >
            <FormInput
              id="densityKgM3"
              type="number"
              step="any"
              min="0"
              placeholder="e.g., 350"
              disabled={isSubmitting}
              error={!!errors.densityKgM3}
              {...register("densityKgM3")}
            />
          </FormField>
        </div>

      </FormSection>

      {/* Destination + Product Details */}
      <FormSection
        title="Destination & product"
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
                disabled={isSubmitting || isEditMode}
                error={!!fieldState.error}
              />
            )}
          />
        </FormField>

        {/* Blend ingredients — each drawn from the feedstock bin holding it */}
        <IngredientBinRows
          composition={composition}
          isSubmitting={isSubmitting}
          allocationFrozen={hasFrozenSourceAllocation}
        />

        <FormField
          id="storageLocationId"
          label="Product bin"
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
        errorMessage={routedServerError.footerError}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </div>
  );
}
