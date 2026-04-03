"use client";

import { numericValue } from "@/lib/form-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea, FormEntitySelect } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui";
import {
  storageLocationFormSchema,
  storageLocationTypes,
  formatStorageLocationType,
  type StorageLocationFormData,
} from "@/schemas/storage-locations";
import type { StorageLocation } from "@/db/schema/facilities";

const storageTypeOptions: readonly { value: string; label: string }[] =
  storageLocationTypes.map((type) => ({
    value: type,
    label: formatStorageLocationType(type),
  }));

interface StorageLocationFormProps {
  storageLocation?: StorageLocation;
  onSubmit: (data: StorageLocationFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
}

export function StorageLocationForm({
  storageLocation,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
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
      type: storageLocation?.type ?? undefined,
      facilityId: storageLocation?.facilityId ?? contextFacilityId ?? "",
      capacityKg: storageLocation?.capacityKg ?? undefined,
      feedstockTypeId: storageLocation?.feedstockTypeId ?? "",
      storageMethod: storageLocation?.storageMethod ?? "",
      storageDescription: storageLocation?.storageDescription ?? "",
    },
  });

  const watchedType = useWatch({ control, name: "type" });
  const showFeedstockType = watchedType === "feedstock_bin" || watchedType === "ingredient_bin";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formControl = control as any;

  const defaultSubmitLabel = isEditMode
    ? "Update Storage Bin"
    : "Create Storage Bin";

  const handleFormSubmit = handleSubmit((data) => {
    const normalized = { ...data } as StorageLocationFormData;
    if (normalized.type !== "feedstock_bin" && normalized.type !== "ingredient_bin") {
      normalized.feedstockTypeId = null;
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
            control={formControl}
            name="feedstockTypeId"
            label="Feedstock Type"
            entityType="feedstockType"
            placeholder="Select feedstock type..."
            disabled={isSubmitting}
            helperText="Restricts this bin to one feedstock type"
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

      {/* Actions */}
      <div className="flex items-center justify-end gap-16 pt-20 border-t border-[var(--color-border-secondary)]">
        {onCancel && (
          <Button type="button" variant="default" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : submitLabel ?? defaultSubmitLabel}
        </Button>
      </div>
    </form>
  );
}
