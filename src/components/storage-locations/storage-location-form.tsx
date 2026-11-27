"use client";

import { FormError } from "@/components/forms/form-error";
import { nullableNumericValue } from "@/lib/form-utils";
import { useFacilityClock, useFacilityContext } from "@/hooks/use-facility-context";
import { EventTimeInput } from "@/components/forms/event-time-input";

import { useId } from "react";
import { LABEL_HIT_AREA } from "@/components/ui/touch-target";
import { cn } from "@/lib/utils";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { useSaveRefusal, type SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  FormEntitySelect,
  FormField,
  FormInput,
  FormTextarea,
  ResolvedErrorRevalidator,
} from "@/components/forms";
import { ChoiceCardGroup } from "@/components/forms/choice-card-group";
import { SegmentedControl } from "@/components/forms/segmented-control";
import { drawOrderOptions, feedstockDrawOrderOptions, stockModeOptions } from "./stock-mode-art";
import { FormActions } from "@/components/forms/form-actions";
import {
  STOCK_MODE_FORM_COPY,
  storageLocationFormSchema,
  storageLocationTypes,
  STORAGE_LOCATION_TYPE_SHORT_LABELS,
  formatStorageLocationType,
  isFeedstockBinType,
  isOutputBinType,
  STORAGE_LOCATION_TYPE_DESCRIPTIONS,
  type StorageLocationFormData,
  type StorageLocationType,
} from "@/schemas/storage-locations";
import type { FeedstockTypeUsage } from "@/schemas/feedstock-types";
import type { StorageLocation } from "@/db/schema/facilities";
import { isBinFormulationLocked, type RecordLockView } from "@/lib/record-lock-view";
import { numberInputConstraintsFor } from "@/lib/number-input-constraints";

/**
 * The form's own values: no storage type is chosen until the operator picks
 * one, which the type radios read as null. The schema still requires it.
 */
type StorageLocationFormValues = Omit<StorageLocationFormData, "type"> & { type: StorageLocationType | null };

const UNCARBONIZED_FIXED_NOTE = "This bin holds uncarbonized material. Products cannot draw from it.";

const schemaResolver = zodResolver(storageLocationFormSchema);
/** The schema reads the draft, null type included, and refuses a missing type. */
const resolveStorageLocation: Resolver<StorageLocationFormValues, unknown, StorageLocationFormData> = (values, context, options) =>
  schemaResolver(values as StorageLocationFormData, context, options as Parameters<typeof schemaResolver>[2]);

/** Native min, max and step for each number input, read from the schema. */
const numberBounds = numberInputConstraintsFor(storageLocationFormSchema);

interface StorageLocationFormProps {
  storageLocation?: StorageLocation;
  /** `onRefusal` shows a refused save at the fields it names (#1327). */
  onSubmit: (data: StorageLocationFormData, onRefusal: SaveRefusalHandler) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  errorMessage?: string;
  submitLabel?: string;
  /** Pre-selected storage type (used by quick-add dialog) */
  defaultType?: StorageLocationType;
  /** Restricts the type picker to these bin types (e.g. feedstock + ingredient) */
  allowedTypes?: readonly StorageLocationType[];
  /** Pre-selects the feedstock type the parent flow is working with */
  defaultFeedstockTypeId?: string;
  /** Narrows selectable/quick-added feedstock types by usage. */
  feedstockTypeUsage?: FeedstockTypeUsage;
  /** Prevents changing a parent-selected feedstock type. */
  lockFeedstockType?: boolean;
  /** Pre-selects the formulation the parent flow is working with */
  defaultFormulationId?: string;
  /** Pre-selects the facility when rendered outside FacilityProvider context */
  defaultFacilityId?: string;
  /** The saved bin's lock: stock history fixes its storage type and feedstock type. */
  lock?: RecordLockView;
  /** Starts a new bin tagged uncarbonized (a caller that creates one for a failed run's output). */
  defaultUncarbonized?: boolean;
  /** Hides the tag's checkbox, for pickers that fix the tag themselves. */
  hideUncarbonized?: boolean;
}

export function StorageLocationForm({
  storageLocation,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
  defaultType,
  allowedTypes,
  defaultFeedstockTypeId,
  feedstockTypeUsage,
  lockFeedstockType = false,
  defaultFormulationId,
  defaultFacilityId,
  lock,
  defaultUncarbonized = false,
  hideUncarbonized = false,
}: StorageLocationFormProps) {
  const isEditMode = !!storageLocation;
  // The identity guard (#767) refuses these two once any stock row points at
  // the bin, and both wait for the lock to answer (fail closed). Stock mode
  // keeps its own inline rule.
  const identityLocked = isEditMode && (!lock || lock.level !== "open");
  // The formulation guard: only the one formulation every stored product has.
  const formulationLocked = isEditMode && (!lock || isBinFormulationLocked(lock, storageLocation?.formulationId ?? null));
  const { facilityId: contextFacilityId } = useFacilityContext();

  const typeChoices = allowedTypes ?? storageLocationTypes;
  // A caller that allows one type (quick-add) fixes it: no choice to draw.
  const fixedType = typeChoices.length === 1 ? typeChoices[0] : undefined;
  const storageTypeOptions = typeChoices.map((type) => ({
    value: type,
    label: STORAGE_LOCATION_TYPE_SHORT_LABELS[type],
  }));

  const latched = useLatchedSubmit();
  const formId = useId();
  const {
    register,
    handleSubmit,
    control,
    trigger,
    setValue,
    setError,
    resetField,
    formState: { errors },
  } = useForm<StorageLocationFormValues, unknown, StorageLocationFormData>({
    resolver: resolveStorageLocation,
    defaultValues: {
      name: storageLocation?.name ?? "",
      // null, not undefined: the type radios read "none chosen" as null, so
      // undefined would read as an edit.
      type: storageLocation?.type ?? defaultType ?? fixedType ?? null,
      facilityId: storageLocation?.facilityId ?? defaultFacilityId ?? contextFacilityId ?? "",
      // null, as nullableNumericValue reads an empty capacity: undefined would
      // read as an edit.
      capacityKg: storageLocation?.capacityKg ?? null,
      feedstockTypeId: storageLocation?.feedstockTypeId ?? defaultFeedstockTypeId ?? "",
      formulationId: storageLocation?.formulationId ?? defaultFormulationId ?? "",
      uncarbonized: storageLocation?.uncarbonized ?? defaultUncarbonized,
      stockMode: storageLocation?.stockMode ?? "split",
      drawOrder: storageLocation?.drawOrder ?? "oldest_first",
      mergedAt: "",
      storageMethod: storageLocation?.storageMethod ?? "",
      storageDescription: storageLocation?.storageDescription ?? "",
    },
  });

  const refuseSave = useSaveRefusal({ control, setError, resetField, formId });
  const watchedType = useWatch({ control, name: "type" });
  const showFeedstockType = isFeedstockBinType(watchedType);
  const copy = showFeedstockType ? STOCK_MODE_FORM_COPY.feedstock : STOCK_MODE_FORM_COPY.output;
  const showFormulation = watchedType === "product_bin";
  const showUncarbonized = watchedType === "biochar_bin" && !hideUncarbonized;
  const fixedUncarbonized = watchedType === "biochar_bin" && hideUncarbonized && defaultUncarbonized;
  // Output bins choose a stock mode; feedstock bins choose a draw method on the same fields.
  const showStockMode = showFeedstockType || isOutputBinType(watchedType);
  const watchedStockMode = useWatch({ control, name: "stockMode" });
  const watchedFacilityId = useWatch({ control, name: "facilityId" });
  const clock = useFacilityClock(watchedFacilityId);
  // Only an existing split bin merges; a new bin simply starts as mix.
  const merging = showStockMode && storageLocation?.stockMode === "split" && watchedStockMode === "mix";
  const unmixing = showStockMode && storageLocation?.stockMode === "mix" && watchedStockMode === "split";
  const typeDescription = watchedType
    ? STORAGE_LOCATION_TYPE_DESCRIPTIONS[watchedType]
    : undefined;
  const feedstockTypeFilter = feedstockTypeUsage
    ? { usage: feedstockTypeUsage }
    : undefined;
  const feedstockTypeHelperText = lockFeedstockType
    ? "Fixed from the parent feedstock record so this bin cannot be assigned to the wrong type."
    : "Restricts this bin to one feedstock type. For certified production, choose a Pyrolysis type that matches Isometric.";

  const defaultSubmitLabel = isEditMode
    ? "Update storage bin"
    : "Create storage bin";

  const handleFormSubmit = latched(handleSubmit((data) => {
    const normalized = { ...data } as StorageLocationFormData;
    if (!isFeedstockBinType(normalized.type)) {
      normalized.feedstockTypeId = null;
    }
    if (normalized.type !== "product_bin") {
      normalized.formulationId = null;
    }
    if (normalized.type !== "biochar_bin") normalized.uncarbonized = false;
    if (!isFeedstockBinType(normalized.type) && !isOutputBinType(normalized.type)) normalized.stockMode = "split";
    if (!merging) normalized.mergedAt = null;
    else if (!normalized.mergedAt) {
      setError("mergedAt", { message: copy.mergeRequired });
      return;
    }
    return onSubmit(normalized, refuseSave);
  }));

  return (
    <form id={formId} onSubmit={handleFormSubmit} className="space-y-20">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        {fixedType ? (
          <div className="flex flex-col gap-6">
            <span className="body-small font-medium text-[var(--color-text-secondary)]">Storage type</span>
            <span className="flex min-h-40 items-center body-small text-[var(--color-text-primary)]">
              {formatStorageLocationType(fixedType)}
            </span>
            <input type="hidden" {...register("type")} />
          </div>
        ) : (
          <FormField
            id="type"
            label="Storage type"
            error={errors.type?.message}
            helperText={typeDescription}
            required
          >
            <SegmentedControl
              id="type"
              legend="Storage type"
              required
              disabled={isSubmitting || identityLocked}
              error={!!errors.type}
              options={storageTypeOptions}
              {...register("type", {
                // The tag's checkbox is hidden off biochar bins, so a stale true must not be sent.
                onChange: (event) => {
                  if (event.target.value !== "biochar_bin") setValue("uncarbonized", false);
                },
              })}
            />
          </FormField>
        )}

        <FormField id="name" label="Bin name" error={errors.name?.message} required>
          <FormInput
            id="name"
            type="text"
            placeholder="e.g., Bin 7"
            disabled={isSubmitting}
            error={!!errors.name}
            {...register("name")}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField
          id="capacityKg"
          label="Capacity (kg)"
          error={errors.capacityKg?.message}
        >
          <FormInput
            id="capacityKg"
            type="number"
            {...numberBounds("capacityKg")}
            placeholder="e.g., 5000"
            disabled={isSubmitting}
            error={!!errors.capacityKg}
            {...register("capacityKg", { setValueAs: nullableNumericValue })}
          />
        </FormField>

        <FormField
          id="storageMethod"
          label="Storage method"
          error={errors.storageMethod?.message}
        >
          <FormInput
            id="storageMethod"
            type="text"
            placeholder="e.g., Covered, ventilated, dry"
            disabled={isSubmitting}
            error={!!errors.storageMethod}
            {...register("storageMethod")}
          />
        </FormField>
      </div>

      {showStockMode && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <div className="md:col-span-2">
          <FormField
            id="stockMode"
            label={copy.modeLabel}
            hint={copy.modeHint}
            error={errors.stockMode?.message}
            helperText={unmixing ? copy.unmixHelper : merging ? copy.mergedHelper : undefined}
            required
          >
            <ChoiceCardGroup
              id="stockMode"
              legend={copy.modeLabel}
              required
              disabled={isSubmitting}
              error={!!errors.stockMode}
              stackArt
              options={stockModeOptions(watchedType)}
              {...register("stockMode", {
                // Merging starts from now, which the operator can move back.
                onChange: (event) => {
                  if (event.target.value === "mix" && storageLocation?.stockMode === "split") {
                    setValue("mergedAt", new Date().toISOString());
                  }
                },
              })}
            />
          </FormField>
          </div>
          {watchedStockMode === "split" && (
            <div className="md:col-span-2">
              <FormField id="drawOrder" label={copy.orderLabel}
                hint={copy.orderHint} error={errors.drawOrder?.message} required>
                <ChoiceCardGroup id="drawOrder" legend={copy.orderLabel} required disabled={isSubmitting}
                  error={!!errors.drawOrder} stackArt options={showFeedstockType ? feedstockDrawOrderOptions : drawOrderOptions} {...register("drawOrder")} />
              </FormField>
            </div>
          )}
          {merging && (
            <div className="md:col-span-2"><FormField id="mergedAt" label={copy.mergeLabel} hint={copy.mergeHint} error={errors.mergedAt?.message} cue={clock.hint} required>
              <EventTimeInput control={control} name="mergedAt" id="mergedAt" timeZone={clock.timeZone} disabled={isSubmitting} />
            </FormField></div>
          )}
        </div>
      )}

      {showFeedstockType && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <div className="md:col-span-2">
<FormEntitySelect
            control={control}
            name="feedstockTypeId"
            label="Feedstock type"
            entityType="feedstockType"
            allowEdit
            placeholder="Select feedstock type..."
            disabled={isSubmitting || identityLocked}
            selectionLocked={lockFeedstockType}
            required
            helperText={feedstockTypeHelperText}
            allowCreate={!lockFeedstockType}
            createLabel="Add new feedstock type"
            filterBy={feedstockTypeFilter}
          />
          </div>
        </div>
      )}

      {fixedUncarbonized && (
        <p className="body-caption text-[var(--color-text-secondary)]">{UNCARBONIZED_FIXED_NOTE}</p>
      )}

      {showUncarbonized && (
        <div className="flex flex-col gap-4">
          <label htmlFor="uncarbonized" className={cn(LABEL_HIT_AREA, "flex items-center gap-12 cursor-pointer")}>
            <input
              type="checkbox"
              id="uncarbonized"
              className="h-[18px] w-[18px] border border-[var(--color-border-primary)] accent-[var(--clr-dark-purple)] cursor-pointer"
              disabled={isSubmitting || identityLocked}
              aria-describedby={errors.uncarbonized?.message ? "uncarbonized-hint uncarbonized-error" : "uncarbonized-hint"}
              aria-invalid={!!errors.uncarbonized}
              {...register("uncarbonized")}
            />
            <span className="body-medium text-[var(--color-text-primary)]">This bin holds uncarbonized material</span>
          </label>
          <p id="uncarbonized-hint" className="body-caption text-[var(--color-text-tertiary)]">
            {identityLocked ? "Fixed once this bin has stock or history." : "For output of failed runs. Products cannot draw from it."}
          </p>
          <FormError id="uncarbonized-error" message={errors.uncarbonized?.message} />
        </div>
      )}

      {showFormulation && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <div className="md:col-span-2">
<FormEntitySelect
            control={control}
            name="formulationId"
            label="Formulation"
            entityType="formulation"
            allowEdit
            placeholder="Pure biochar (no formulation)"
            disabled={isSubmitting || formulationLocked}
            helperText={formulationLocked
              ? "Fixed while this bin stores product of this formulation. Move or remove the product to change it."
              : "Restricts this bin to one formulation. Leave it empty for a pure biochar bin, which the first formulated product stored here will claim."}
            allowCreate
            createLabel="Add new formulation"
          />
          </div>
        </div>
      )}

      <FormField
        id="storageDescription"
        label="Description"
        error={errors.storageDescription?.message}
      >
        <FormTextarea
          id="storageDescription"
          placeholder="Additional details about storage conditions or handling"
          disabled={isSubmitting}
          error={!!errors.storageDescription}
          {...register("storageDescription")}
        />
      </FormField>

      <FormActions
        control={control}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
