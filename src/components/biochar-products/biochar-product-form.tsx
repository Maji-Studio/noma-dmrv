/**
 * BiocharProductForm component
 * Redesigned form with visual bin transfer flow
 */
"use client";

import { useFacilityContext } from "@/hooks/use-facility-context";
import { nullableNumericValue } from "@/lib/form-utils";
import { useEffect, useId, useRef, useState, type ComponentProps } from "react";

import { EntitySelect, FormActions, FormField, FormInput, FormSection, FormSpine, MassMoistureFields, StockReconciliationLink } from "@/components/forms";
import {
  StorageLocationQuickAddDialog,
  useQuickAddDialog,
} from "@/components/forms/entity-select";
import { ActionableFocusTarget } from "@/components/ui/actionable-focus-target";
import type { BiocharProductWithRelations } from "@/data-access/biochar-products";
import { useInlineStockServerError } from "@/hooks/use-inline-stock-server-error";
import { useProductStockPreview } from "@/hooks/use-product-stock-preview";
import { useOutputStockPreview } from "@/hooks/use-output-stock";
import {
  deriveBlendMassKg,
  deriveSourceBiocharMassKg,
  fromCompositionJsonb,
  SOURCE_BIOCHAR_MASS_ERROR,
  useBiocharComposition,
  ZERO_SOURCE_BIOCHAR_ERROR,
} from "@/lib/biochar-composition";
import { formatLocalDate } from "@/lib/date-utils";
import type { EntityFocusTarget } from "@/lib/entity-deep-link";
import { MASS_MOISTURE_LABELS, qualifyMassLabel, splitWetMassAfterAddedWater, WET_MASS_FIELD_LABEL } from "@/lib/mass-moisture";
import {
  binStockOverdrawMessage,
} from "@/lib/stock-overdraw";
import {
  biocharProductFormSchema,
  PURE_PRODUCT_BIN_FILTER,
  type BiocharProductFormData,
} from "@/schemas/biochar-products";
import {
  MASS_KG_INPUT_STEP,
} from "@/schemas/helpers";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { zodResolver } from "@hookform/resolvers/zod";
import { FactoryIcon, PackageIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { FormDetailToggle, type FormDetailLevel } from "@/components/forms/form-detail-toggle";
import { CalculationFacts, CompositionCard, ingredientComponents, type CompositionComponent } from "./composition-card";
import { StockChangeLabel, StockContext } from "./stock-context";
import { IngredientBinRows } from "./ingredient-bin-rows";
import { ZeroSourceBiocharWarning } from "./zero-source-biochar-warning";


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
  const [detailLevel, setDetailLevel] = useState<FormDetailLevel>("simple");
  const detailed = detailLevel === "detailed";
  const [idempotencyKey] = useState(() => crypto.randomUUID());
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
      idempotencyKey,
      basisFingerprint: "pending-preview",
      facilityId: product?.facility?.id ?? contextFacilityId ?? "",
      formulationId: initialFormulationId ?? "",
      placedAt: product?.placedAt ?? formatLocalDate(new Date()),
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
  const watchedPlacedAt = useWatch({ control, name: "placedAt" });
  const watchedMassKg = useWatch({ control, name: "massKg" });
  const watchedIngredientBins = useWatch({ control, name: "ingredientBins" });
  const watchedMoisture = useWatch({ control, name: "moistureContentPercent" });
  const watchedWaterAddedKg = useWatch({ control, name: "waterAddedKg" });

  const composition = useBiocharComposition(form, {
    formulationId: selectedFormulationId,
    facilityId: selectedFacilityId,
    allocationFrozen: hasFrozenSourceAllocation,
  });

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
  const sourcePreview = useOutputStockPreview(!isEditMode && sourceBiocharStorageLocationId && watchedPlacedAt && requestedBiocharKg != null && requestedBiocharKg > 0 && watchedMoisture != null ? {
    storageLocationId: sourceBiocharStorageLocationId,
    facilityId: selectedFacilityId,
    physicalDate: String(watchedPlacedAt), kind: "production_draw", wetMassKg: requestedBiocharKg,
    moisturePercent: Number(watchedMoisture),
  } : null);
  const ingredientMassesComplete = (watchedIngredientBins ?? []).every(
    (ingredient) =>
      typeof ingredient.massKg === "number" &&
      Number.isFinite(ingredient.massKg) &&
      ingredient.massKg >= 0,
  );
  const productStockPreview = useProductStockPreview(!isEditMode && ingredientMassesComplete && sourceBiocharStorageLocationId && storageLocationId && selectedFormulationId && watchedPlacedAt && massKgNum !== null && watchedMoisture != null && watchedWaterAddedKg != null ? {
    facilityId: selectedFacilityId, formulationId: selectedFormulationId, placedAt: String(watchedPlacedAt),
    sourceBiocharStorageLocationId, storageLocationId, massKg: massKgNum, moistureContentPercent: Number(watchedMoisture),
    waterAddedKg: Number(watchedWaterAddedKg), ingredientBins: watchedIngredientBins?.map(ingredient => ({ ...ingredient, massKg: typeof ingredient.massKg === "number" ? ingredient.massKg : Number.NaN })),
  } : null);
  const affectedBinsUnavailable = !productStockPreview.data || productStockPreview.isFetching || !!productStockPreview.error || productStockPreview.data.some(bin => !!bin.blockingMessage);

  const biocharStockError = sourcePreview.data?.blockingMessage ?? sourcePreview.error?.message;
  const refreshStockPreview = sourcePreview.refetch;
  useEffect(() => {
    if (errorMessage && !isEditMode) void refreshStockPreview();
  }, [errorMessage, isEditMode, refreshStockPreview]);

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

  const handleFormSubmit = handleSubmit(async (data) => {
    if (!isEditMode && (!sourcePreview.data || sourcePreview.isFetching || sourcePreview.data.blockingMessage || affectedBinsUnavailable)) return;
    try {
      await onSubmit({
        ...prepareBiocharProductSubmission(data as BiocharProductFormData, hasFrozenSourceAllocation, isEditMode ? product?.massKg ?? undefined : undefined),
        basisFingerprint: productStockPreview.data?.[0]?.basisFingerprint ?? sourcePreview.data?.basisFingerprint ?? data.basisFingerprint,
        idempotencyKey,
      });
    } catch (error) {
      void sourcePreview.refetch();
      void productStockPreview.refetch();
      throw error;
    }
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
  // The wet product total is a claim about the finished blend, so it stays
  // hidden until water and every ingredient mass are actually entered —
  // otherwise blank required fields read as a smaller final product.

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

  const validSourcePreview = !sourcePreview.isFetching && !sourcePreview.error && !sourcePreview.data?.blockingMessage ? sourcePreview.data : undefined;
  const destinationPreview = !affectedBinsUnavailable ? productStockPreview.data?.find(bin => bin.lane === "product") : undefined;
  // Server FIFO allocation is authoritative for new products; frozen allocation wins on edit.
  const sourceDryKg = isEditMode ? destinationDryBiocharKg : validSourcePreview?.removedDryKg ?? null;
  const sourceComponents: CompositionComponent[] = [
    { label: "Biochar (dry)", massKg: sourceDryKg, kind: "biochar" },
    { label: "Water in biochar", massKg: sourceDryKg !== null && massKgNum !== null && sourceDryKg <= massKgNum ? massKgNum - sourceDryKg : null, kind: "water" },
    { label: "Added water", massKg: waterAddedKgNum !== null && waterAddedKgNum >= 0 ? waterAddedKgNum : null, kind: "addedWater" },
  ];
  const productComponents = [...sourceComponents, ...(watchedIngredientBins ?? []).flatMap(ingredient => ingredientComponents(ingredient, hasFrozenSourceAllocation, !affectedBinsUnavailable ? productStockPreview.data?.find(bin => bin.storageLocationId === ingredient.storageLocationId) : undefined))];

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
      <div className="flex justify-end"><FormDetailToggle value={detailLevel} onChange={setDetailLevel} /></div>
      {productStockPreview.error && <p role="alert">{productStockPreview.error.message}</p>}
      {productStockPreview.data?.filter(bin => bin.blockingMessage && bin.lane !== "biochar").map(bin => <p key={bin.storageLocationId} role="alert" className="body-small text-[var(--st-bad)]">{bin.binName}: {bin.blockingMessage}</p>)}
      {productStockPreview.isFetching && <p role="status">Refreshing affected bins...</p>}
      {sourcePreview.isFetching && <p role="status">Refreshing source stock preview...</p>}
      <FormSpine control={control}>
      <FormSection title="Placement" fields={["placedAt"]}>
        <FormField id="placedAt" label="Mixing and placement date" required error={errors.placedAt?.message} helperText="The date this product was physically mixed and placed in its bin.">
          <FormInput id="placedAt" type="date" disabled={isSubmitting || isEditMode} {...register("placedAt")} />
        </FormField>
      </FormSection>
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
                formatSelectedLabel={entity => <StockChangeLabel name={entity.name} preview={validSourcePreview} available={!isEditMode && !sourcePreview.isFetching && !sourcePreview.error} />}
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
          splitPreview={detailed ? <CompositionCard title="Source composition" totalKg={waterAddedKgNum !== null ? finalMassSplit?.wetKg ?? null : null} components={sourceComponents} details={<><CalculationFacts facts={[{ label: "Biochar wet mass", massKg: massKgNum }, { label: "Dry biochar", massKg: sourceDryKg }, { label: "Added water", massKg: waterAddedKgNum }]} /><p>{hasFrozenSourceAllocation ? "Dry biochar is fixed by the recorded source allocation. Updating moisture does not change that allocation." : "Dry biochar comes from the source allocation at the measured moisture."} Added water leaves dry biochar unchanged.</p><StockContext preview={validSourcePreview} facilityId={selectedFacilityId} /></>} /> : null}
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
        title="Formulation & ingredients"
        icon={<PackageIcon size={14} weight="bold" />}
        fields={["formulationId", "ingredientBins"]}
      >

        {/* Formulation drives ingredient-bin rows and the destination bin filter. */}
        <FormField
          id="formulationId"
          label="Formulation"
          error={errors.formulationId?.message}
          required
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
              />
            )}
          />
        </FormField>

        {/* Blend ingredients — each drawn from the feedstock bin holding it */}
        <IngredientBinRows
          composition={composition}
          isSubmitting={isSubmitting}
          allocationFrozen={hasFrozenSourceAllocation}
          detailed={detailed}
          previews={productStockPreview.data}
          previewsAvailable={!affectedBinsUnavailable}
        />
      </FormSection>
      <FormSection title="Product" icon={<PackageIcon size={14} weight="bold" />} fields={["storageLocationId"]}>

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
                formatSelectedLabel={entity => <StockChangeLabel name={entity.name} preview={destinationPreview} available={!affectedBinsUnavailable} />}
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
        {detailed && <CompositionCard title="Product composition" totalKg={destinationWetProductKg} components={productComponents} details={<><CalculationFacts facts={[{ label: "Source biochar (wet)", massKg: massKgNum }, ...(watchedIngredientBins ?? []).map(ingredient => ({ label: `${ingredient.feedstockTypeName} (wet)`, massKg: typeof ingredient.massKg === "number" ? ingredient.massKg : null })), { label: "Added water", massKg: waterAddedKgNum }, { label: "Wet total", massKg: destinationWetProductKg }]} /><p>Wet total = source biochar + ingredients + added water. Dry biochar excludes ingredient solids and water.</p><StockContext preview={destinationPreview} facilityId={selectedFacilityId} /></>} />}
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
        errorMessage={routedServerError.footerError}
        submitDisabled={hasZeroSourceBiochar || !isEditMode && (!sourcePreview.data || sourcePreview.isFetching || !!sourcePreview.data.blockingMessage || affectedBinsUnavailable)}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </div>
  );
}
