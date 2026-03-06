"use client";

import { numericValue } from "@/lib/form-utils";
import { useFacilityContext } from "@/hooks/use-facility-context";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
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
    formState: { errors },
  } = useForm<StorageLocationFormData>({
    resolver: zodResolver(storageLocationFormSchema),
    defaultValues: {
      name: storageLocation?.name ?? "",
      type: storageLocation?.type ?? undefined,
      facilityId: storageLocation?.facilityId ?? contextFacilityId ?? "",
      capacityKg: storageLocation?.capacityKg ?? undefined,
      latitude: storageLocation?.latitude ?? undefined,
      longitude: storageLocation?.longitude ?? undefined,
      storageMethod: storageLocation?.storageMethod ?? "",
      storageDescription: storageLocation?.storageDescription ?? "",
    },
  });

  const defaultSubmitLabel = isEditMode
    ? "Update Storage Location"
    : "Create Storage Location";

  const handleFormSubmit = handleSubmit((data) => {
    return onSubmit(data as StorageLocationFormData);
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

        <FormField id="name" label="Location Name" error={errors.name?.message} required>
          <FormInput
            id="name"
            type="text"
            placeholder="e.g., Feedstock Intake Bay 1"
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField
          id="latitude"
          label="Latitude"
          error={errors.latitude?.message}
        >
          <FormInput
            id="latitude"
            type="number"
            step="any"
            placeholder="e.g., -3.3349"
            disabled={isSubmitting}
            error={!!errors.latitude}
            {...register("latitude", { setValueAs: numericValue })}
          />
        </FormField>

        <FormField
          id="longitude"
          label="Longitude"
          error={errors.longitude?.message}
        >
          <FormInput
            id="longitude"
            type="number"
            step="any"
            placeholder="e.g., 37.3404"
            disabled={isSubmitting}
            error={!!errors.longitude}
            {...register("longitude", { setValueAs: numericValue })}
          />
        </FormField>
      </div>

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
