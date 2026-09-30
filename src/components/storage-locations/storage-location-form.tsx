"use client";

import { nullableNumericValue } from "@/lib/form-utils";
import { useFacilityClock, useFacilityContext } from "@/hooks/use-facility-context";
import { EventTimeInput } from "@/components/forms/event-time-input";

import { useForm, useWatch } from "react-hook-form";
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
import { stockModeOptions } from "./stock-mode-art";
import { FormActions } from "@/components/forms/form-actions";
import {
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

const STOCK_MODE_HINT =
  "Split keeps every batch in its own bay, bag or heap, and each removal records which batches it came from. Mix is one blended pile: every removal takes each batch in proportion to what it holds.";
const MERGE_TIME_HINT =
  "Removals from this time on take every batch in proportion. Entries already saved keep their shares.";

interface StorageLocationFormProps {
  storageLocation?: StorageLocation;
  onSubmit: (data: StorageLocationFormData) => Promise<void> | void;
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
}: StorageLocationFormProps) {
  const isEditMode = !!storageLocation;
  const { facilityId: contextFacilityId } = useFacilityContext();

  const typeChoices = allowedTypes ?? storageLocationTypes;
  // A caller that allows one type (quick-add) fixes it: no choice to draw.
  const fixedType = typeChoices.length === 1 ? typeChoices[0] : undefined;
  const storageTypeOptions = typeChoices.map((type) => ({
    value: type,
    label: STORAGE_LOCATION_TYPE_SHORT_LABELS[type],
  }));

  const {
    register,
    handleSubmit,
    control,
    trigger,
    setValue,
    setError,
    formState: { errors },
  } = useForm<StorageLocationFormData>({
    resolver: zodResolver(storageLocationFormSchema),
    defaultValues: {
      name: storageLocation?.name ?? "",
      type: storageLocation?.type ?? defaultType ?? fixedType,
      facilityId: storageLocation?.facilityId ?? defaultFacilityId ?? contextFacilityId ?? "",
      capacityKg: storageLocation?.capacityKg ?? undefined,
      feedstockTypeId: storageLocation?.feedstockTypeId ?? defaultFeedstockTypeId ?? "",
      formulationId: storageLocation?.formulationId ?? defaultFormulationId ?? "",
      stockMode: storageLocation?.stockMode ?? "split",
      mergedAt: "",
      storageMethod: storageLocation?.storageMethod ?? "",
      storageDescription: storageLocation?.storageDescription ?? "",
    },
  });

  const watchedType = useWatch({ control, name: "type" });
  const showFeedstockType = isFeedstockBinType(watchedType);
  const showFormulation = watchedType === "product_bin";
  const showStockMode = isOutputBinType(watchedType);
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

  const handleFormSubmit = handleSubmit((data) => {
    const normalized = { ...data } as StorageLocationFormData;
    if (!isFeedstockBinType(normalized.type)) {
      normalized.feedstockTypeId = null;
    }
    if (normalized.type !== "product_bin") {
      normalized.formulationId = null;
    }
    if (!isOutputBinType(normalized.type)) normalized.stockMode = "split";
    if (!merging) normalized.mergedAt = null;
    else if (!normalized.mergedAt) {
      setError("mergedAt", { message: "Enter when the batches were merged." });
      return;
    }
    return onSubmit(normalized);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
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
              disabled={isSubmitting}
              error={!!errors.type}
              options={storageTypeOptions}
              {...register("type")}
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
            step="any"
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
            label="Stock mode"
            hint={STOCK_MODE_HINT}
            error={errors.stockMode?.message}
            helperText={unmixing ? "Only an empty bin can switch to split." : merging ? "Switching back to split needs an empty bin." : undefined}
            required
          >
            <ChoiceCardGroup
              id="stockMode"
              legend="Stock mode"
              disabled={isSubmitting}
              error={!!errors.stockMode}
              stackArt
              options={stockModeOptions(watchedType === "product_bin" ? "product_bin" : "biochar_bin")}
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
          {merging && (
            <div className="md:col-span-2"><FormField id="mergedAt" label="Merged at" hint={MERGE_TIME_HINT} error={errors.mergedAt?.message} cue={clock.hint} required>
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
            placeholder="Select feedstock type..."
            disabled={isSubmitting || lockFeedstockType}
            required
            helperText={feedstockTypeHelperText}
            allowCreate={!lockFeedstockType}
            createLabel="Add new feedstock type"
            filterBy={feedstockTypeFilter}
          />
          </div>
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
            placeholder="Pure biochar (no formulation)"
            disabled={isSubmitting}
            helperText="Restricts this bin to one formulation. Leave it empty for a pure biochar bin, which the first formulated product stored here will claim."
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
