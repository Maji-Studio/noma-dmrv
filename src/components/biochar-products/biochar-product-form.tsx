/**
 * BiocharProductForm component
 * Redesigned form with visual bin transfer flow
 */
"use client";

import { useEffect, useId, useRef, type ComponentProps } from "react";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { nullableNumericValue } from "@/lib/form-utils";

import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FactoryIcon, PackageIcon, FlowArrowIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, EntitySelect, FormSection, FormSpine, FormActions, SectionLabel, MassMoistureFields, StockReconciliationLink } from "@/components/forms";
import { MASS_MOISTURE_LABELS, splitWetMass, splitWetMassAfterAddedWater, qualifyMassLabel, WET_MASS_FIELD_LABEL } from "@/lib/mass-moisture";
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
  deriveBlendMassKg,
  deriveSourceBiocharMassKg,
  fromCompositionJsonb,
  SOURCE_BIOCHAR_MASS_ERROR,
  ZERO_SOURCE_BIOCHAR_ERROR,
  useBiocharComposition,
} from "@/lib/biochar-composition";
import { IngredientBinRows } from "./ingredient-bin-rows";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";
import Link from "next/link";
import { PURE_BIOCHAR_LABEL } from "@/config/product-labels";
import { useStockAvailability } from "@/hooks/use-stock-availability";
import { useInlineStockServerError } from "@/hooks/use-inline-stock-server-error";
import {
  binStockOverdrawInlineMessage,
  binStockOverdrawMessage,
  isStockOverdraw,
} from "@/lib/stock-overdraw";
import { ZeroSourceBiocharWarning } from "./zero-source-biochar-warning";
import { ProductCompositionPreview } from "@/components/ui/product-composition-preview";

const PRODUCT_BIN_QUICK_ADD_TYPES = ["product_bin"] as const satisfies readonly StorageLocationType[];
const SET_VALUE_OPTS = { shouldDirty: true, shouldTouch: true, shouldValidate: true } as const;

type MassMoistureFieldsProps = ComponentProps<typeof MassMoistureFields>;

/**
 * The operator enters the wet biochar drawn from the source bin. Blend
 * ingredients stack on top of this figure; they never reduce it.
 */
export function BiocharSourceMassFields({
  wet,
  materialLabel,
  ...props
}: MassMoistureFieldsProps) {
  return (
    <MassMoistureFields
      {...props}
      materialLabel={materialLabel}
      finalMoistureLabel={qualifyMassLabel(
        MASS_MOISTURE_LABELS.finalMoisture,
        "Biochar + water",
      )}
      wet={{
        ...wet,
        label: qualifyMassLabel(WET_MASS_FIELD_LABEL, materialLabel ?? "Biochar"),
        helperText: wet.helperText ?? "Wet biochar drawn from the source bin.",
      }}
    />
  );
}

/**
 * The form captures the biochar-only wet mass, while the persisted `massKg`
 * stays the pre-water blend total (biochar plus every recorded ingredient) so
 * server accounting is unchanged. Edits pass the stored total through
 * verbatim: the mass field is disabled, and rebuilding the total from rows
 * reconciled against a since-edited formulation would silently change the
 * record. Immutable source allocations additionally keep their persisted
 * composition server-side.
 */
export function prepareBiocharProductSubmission(
  data: BiocharProductFormData,
  allocationFrozen: boolean,
  persistedBlendMassKg?: number,
): BiocharProductFormData {
  const massKg =
    persistedBlendMassKg !== undefined
      ? persistedBlendMassKg
      : deriveBlendMassKg(
          typeof data.massKg === "number" ? data.massKg : null,
          data.ingredientBins,
        ) ?? data.massKg;
  const next = { ...data, massKg };
  return allocationFrozen
    ? { ...next, ingredientBins: undefined }
    : next;
}

// ============================================
// Transfer Flow Visual
// ============================================

/** One line on the transfer arrow: a mass joining the blend on its way to the bin. */
export interface TransferAddition {
  label: string;
  massKg: number;
}

/**
 * Keep the preview dry-mass first and intentionally terse. The source summary
 * reads as one stock equation: available dry biochar, planned subtraction, and
 * the remaining stock. Wet mass stays in the editable fields below. Ingredient
 * and water additions ride the arrow; the destination shows the dry biochar
 * plus the total wet product that lands in the bin.
 */
export function TransferFlowPreview({
  sourceBinName,
  sourceAvailableDryMassKg,
  sourceWetMassKg,
  moisturePercent = null,
  recordedSourceDryMassKg = null,
  additions = [],
  destinationDryMassKg,
  destinationWetProductKg = null,
  destinationBinLabel,
  isEditMode = false,
}: {
  sourceBinName: string | null;
  sourceAvailableDryMassKg: number | null;
  sourceWetMassKg: number | null;
  /** Entered biochar moisture. It fixes the dry draw during creation. */
  moisturePercent?: number | null;
  recordedSourceDryMassKg?: number | null;
  /** Ingredient and water masses added between source and destination. */
  additions?: TransferAddition[];
  destinationDryMassKg: number | null;
  /** Total wet product landing in the bin: biochar, water and ingredients. */
  destinationWetProductKg?: number | null;
  destinationBinLabel: string | null;
  isEditMode?: boolean;
}) {
  const hasSource = !!sourceBinName;
  const hasWetTransfer = sourceWetMassKg !== null && sourceWetMassKg > 0;
  // Creation previews the same dry draw the server records: the wet draw at
  // the entered biochar moisture, which is a fresh measurement of the drawn
  // biochar. Edits must use the immutable allocation recorded at creation.
  const measuredSourceDryMassKg = hasWetTransfer
    ? splitWetMass(sourceWetMassKg, moisturePercent)?.dryKg ?? null
    : null;
  const sourceDryMassKg = isEditMode
    ? recordedSourceDryMassKg
    : measuredSourceDryMassKg;
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
              Dry biochar available:{" "}
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
                  ? "Add biochar wet mass to calculate the transfer."
                  : isEditMode && recordedSourceDryMassKg === null
                    ? "Recorded source dry allocation is not available."
                    : !isEditMode && measuredSourceDryMassKg === null
                      ? "Record moisture to calculate the dry draw."
                      : sourceAvailableDryMassKg === null
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

      {/* The arrow carries what joins the blend on the way to the bin. */}
      <div className="flex flex-col items-center justify-center gap-4 py-2 sm:px-4 sm:py-0">
        <svg
          aria-hidden="true"
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
        {additions.length > 0 && (
          <ul
            aria-label="Added to the blend"
            className="flex flex-col items-center gap-2"
          >
            {additions.map((addition, index) => (
              <li
                key={`${addition.label}-${index}`}
                className="body-caption whitespace-nowrap text-[var(--color-text-secondary)]"
              >
                +{formatMassKg(addition.massKg)} {addition.label}
              </li>
            ))}
          </ul>
        )}
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
            {(destinationDryMassKg !== null || destinationWetProductKg !== null) && (
              <ProductCompositionPreview
                wetMassKg={destinationWetProductKg}
                dryBiocharKg={destinationDryMassKg}
                wetLabel="Final wet biochar product"
                framed={false}
                className="mt-6"
              />
            )}
            {hasWetTransfer && destinationDryMassKg === null && (
              <span className="body-small text-[var(--color-text-tertiary)] mt-6">
                Record moisture to calculate the dry biochar.
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
  const initialIngredientBins = fromCompositionJsonb(product?.composition);
  const initialSourceBiocharMassKg = product
    ? deriveSourceBiocharMassKg(product.massKg, initialIngredientBins)
    : null;
  const hasZeroSourceBiochar = initialSourceBiocharMassKg === 0;
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
      // The field carries the biochar-only wet mass; the record stores the
      // blend total, so edit mode subtracts the persisted ingredient masses.
      massKg: product
        ? initialSourceBiocharMassKg
        : null,
      moistureContentPercent: product?.moistureContentPercent ?? null,
      densityKgM3: product?.densityKgM3 ?? null,
      waterAddedKg: product?.waterAddedKg ?? null,
      ingredientBins: initialIngredientBins,
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

  const composition = useBiocharComposition(form, {
    formulationId: selectedFormulationId,
    facilityId: selectedFacilityId,
    allocationFrozen: hasFrozenSourceAllocation,
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

  // The entered mass IS the source draw: ingredients stack on top of it and
  // never reduce what leaves the biochar bin.
  const massKgNum = typeof watchedMassKg === "number" ? watchedMassKg : null;
  const requestedBiocharKg = massKgNum;
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
    requestedBiocharKg !== null &&
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
      message === SOURCE_BIOCHAR_MASS_ERROR ||
      message === ZERO_SOURCE_BIOCHAR_ERROR,
  );
  const massKgError =
    errors.massKg?.message ??
    biocharStockError ??
    routedServerError.inlineError;

  const handleFormSubmit = handleSubmit((data) => {
    return onSubmit(
      prepareBiocharProductSubmission(
        data as BiocharProductFormData,
        hasFrozenSourceAllocation,
        isEditMode ? product?.massKg ?? undefined : undefined,
      ),
    );
  });

  // Derive preview values
  const moistureNum = typeof watchedMoisture === "number" ? watchedMoisture : null;
  const waterAddedKgNum =
    typeof watchedWaterAddedKg === "number" && Number.isFinite(watchedWaterAddedKg)
      ? watchedWaterAddedKg
      : null;
  const finalMassSplit = splitWetMassAfterAddedWater(
    massKgNum,
    moistureNum,
    waterAddedKgNum,
  );
  const ingredientAdditions: TransferAddition[] = (
    watchedIngredientBins ?? []
  ).flatMap((ingredient) =>
    typeof ingredient.massKg === "number" &&
    Number.isFinite(ingredient.massKg) &&
    ingredient.massKg > 0
      ? [{ label: ingredient.feedstockTypeName, massKg: ingredient.massKg }]
      : [],
  );
  const transferAdditions =
    waterAddedKgNum !== null && waterAddedKgNum > 0
      ? [...ingredientAdditions, { label: "Water", massKg: waterAddedKgNum }]
      : ingredientAdditions;
  // The wet product total is a claim about the finished blend, so it stays
  // hidden until water and every ingredient mass are actually entered —
  // otherwise blank required fields read as a smaller final product.
  const ingredientMassesComplete = (watchedIngredientBins ?? []).every(
    (ingredient) =>
      typeof ingredient.massKg === "number" &&
      Number.isFinite(ingredient.massKg) &&
      ingredient.massKg >= 0,
  );
  const blendMassKg = deriveBlendMassKg(massKgNum, watchedIngredientBins);
  const destinationWetProductKg =
    blendMassKg !== null &&
    ingredientMassesComplete &&
    waterAddedKgNum !== null &&
    waterAddedKgNum >= 0
      ? blendMassKg + waterAddedKgNum
      : null;
  const destinationDryBiocharKg = isEditMode
    ? product?.sourceAllocatedDryMassKg ?? finalMassSplit?.dryKg ?? null
    : finalMassSplit?.dryKg ?? null;

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
      <ZeroSourceBiocharWarning
        sourceBiocharMassKg={initialSourceBiocharMassKg}
      />
      {/* Transfer preview — a derived recap of the transfer, not a data-entry
          step, so it sits above the numbered spine and only when it has data. */}
      {(selectedSourceBiocharBin || selectedStorageLocation || massKgNum != null) && (
        <div className="space-y-12">
          <SectionLabel icon={<FlowArrowIcon size={14} weight="bold" />}>
            Transfer preview
          </SectionLabel>
          <TransferFlowPreview
            sourceBinName={selectedSourceBiocharBin?.name ?? null}
            sourceAvailableDryMassKg={
              selectedSourceBiocharBin?.remainingMass?.dryKg ?? null
            }
            sourceWetMassKg={requestedBiocharKg}
            moisturePercent={moistureNum}
            recordedSourceDryMassKg={
              product?.sourceAllocatedDryMassKg ?? null
            }
            additions={transferAdditions}
            destinationDryMassKg={destinationDryBiocharKg}
            destinationWetProductKg={destinationWetProductKg}
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

        <BiocharSourceMassFields
          materialLabel="Biochar"
          wetMassKg={watchedMassKg}
          moisturePercent={watchedMoisture}
          addedWaterKg={watchedWaterAddedKg}
          wet={{
            id: "massKg",
            error: massKgError,
            required: true,
            disabled: isSubmitting || isEditMode,
            placeholder: "e.g. 500",
            helperText: isEditMode
              ? "Source allocation is fixed."
              : undefined,
            registration: register("massKg", { setValueAs: nullableNumericValue }),
          }}
          moisture={{
            id: "moistureContentPercent",
            error: errors.moistureContentPercent?.message,
            required: true,
            disabled: isSubmitting,
            placeholder: "e.g. 2",
            helperText: "Typically 1 to 2% for biochar",
            registration: register("moistureContentPercent", { setValueAs: nullableNumericValue }),
          }}
          addedWaterField={
            <>
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
            </>
          }
          splitFooter={
            ((biocharStockError !== undefined &&
              biocharStockError !== SOURCE_BIOCHAR_MASS_ERROR) ||
              routedServerError.inlineError ===
                binStockOverdrawMessage("biochar")) && (
              <StockReconciliationLink facilityId={contextFacilityId} />
            )
          }
        />

      </FormSection>

      {/* Destination + Product Details */}
      <FormSection
        title="Destination & product"
        icon={<PackageIcon size={14} weight="bold" />}
        fields={["formulationId", "storageLocationId"]}
      >

        {/* Formulation drives ingredient-bin rows and the destination bin filter.
            The explicit none choice produces a pure-biochar product. */}
        <FormField
          id="formulationId"
          label="Formulation"
          error={errors.formulationId?.message}
        >
          <Controller
            name="formulationId"
            control={control}
            render={({ field, fieldState }) => (
              <EntitySelect
                entityType="formulation"
                value={field.value || ""}
                onChange={field.onChange}
                disabled={isSubmitting || isEditMode}
                error={!!fieldState.error}
                noneOption={{
                  label: `None (${PURE_BIOCHAR_LABEL})`,
                  subtitle: "No amendment blend",
                }}
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
        control={form.control}
        formId={formId}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitDisabled={hasZeroSourceBiochar}
        errorMessage={routedServerError.footerError}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </div>
  );
}
