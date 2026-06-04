"use client";

import { numericValue } from "@/lib/form-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea, FormEntitySelect } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { FormActions } from "@/components/forms/form-actions";
import {
  storageLocationFormSchema,
  storageLocationTypes,
  formatStorageLocationType,
  type StorageLocationFormData,
  type StorageLocationType,
} from "@/schemas/storage-locations";
import type { StorageLocation } from "@/db/schema/facilities";

const storageTypeOptions: readonly { value: string; label: string }[] =
  storageLocationTypes.map((type) => ({
    value: type,
    label: formatStorageLocationType(type),
  }));

const FEEDSTOCK_BIN_TYPES: readonly string[] = ["feedstock_bin", "ingredient_bin"];

interface StorageLocationFormProps {
  storageLocation?: StorageLocation;
  onSubmit: (data: StorageLocationFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
  /** Pre-selected storage type (used by quick-add dialog) */
  defaultType?: StorageLocationType;
}

export function StorageLocationForm({
  storageLocation,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  defaultType,
}: StorageLocationFormProps) {
  const isEditMode = !!storageLocation;
  const { facilityId: contextFacilityId } = useFacilityContext();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<StorageLocationFormData>({
    resolver: zodResolver(storageLocationFormSchema),
    defaultValues: {
      name: storageLocation?.name ?? "",
      type: storageLocation?.type ?? defaultType ?? undefined,
      facilityId: storageLocation?.facilityId ?? contextFacilityId ?? "",
      capacityKg: storageLocation?.capacityKg ?? undefined,
      feedstockTypeId: storageLocation?.feedstockTypeId ?? "",
      formulationId: storageLocation?.formulationId ?? "",
      storageMethod: storageLocation?.storageMethod ?? "",
      storageDescription: storageLocation?.storageDescription ?? "",
    },
  });

  const watchedType = useWatch({ control, name: "type" });
  const showFeedstockType = !!watchedType && FEEDSTOCK_BIN_TYPES.includes(watchedType);
  const showFormulation = watchedType === "product_bin";

  const defaultSubmitLabel = isEditMode
    ? "Update Storage Bin"
    : "Create Storage Bin";

  const handleFormSubmit = handleSubmit((data) => {
    const normalized = { ...data } as StorageLocationFormData;
    if (!normalized.type || !FEEDSTOCK_BIN_TYPES.includes(normalized.type)) {
      normalized.feedstockTypeId = null;
    }
    if (normalized.type !== "product_bin") {
      normalized.formulationId = null;
    }
    return onSubmit(normalized);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField id="type" label="Storage Type" error={errors.type?.message} required>
          <FormSelect
            id="type"
            placeholder="Select storage type..."
            disabled={isSubmitting}
            error={!!errors.type}
            options={storageTypeOptions}
            {...register("type")}
          />
        </FormField>

        <FormField id="name" label="Bin Name" error={errors.name?.message} required>
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
            {...register("capacityKg", { setValueAs: numericValue })}
          />
        </FormField>

        <FormField
          id="storageMethod"
          label="Storage Method"
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

      {showFeedstockType && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormEntitySelect
            control={control}
            name="feedstockTypeId"
            label="Feedstock Type"
            entityType="feedstockType"
            placeholder="Select feedstock type..."
            disabled={isSubmitting}
            helperText="Restricts this bin to one feedstock type"
          />
        </div>
      )}

      {showFormulation && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormEntitySelect
            control={control}
            name="formulationId"
            label="Formulation"
            entityType="formulation"
            placeholder="Pure biochar (no formulation)"
            disabled={isSubmitting}
            helperText="Keeps this bin clean — restricts it to one formulation. Leave empty for pure biochar."
          />
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
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
