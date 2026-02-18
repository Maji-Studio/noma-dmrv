/**
 * StorageLocationForm component
 * Reusable storage location form with React Hook Form integration
 * Used in both create and edit slide-overs for storage locations
 */
"use client";

import { useForm } from "react-hook-form";
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

// ============================================
// Constants for select options
// ============================================

const storageTypeOptions: readonly { value: string; label: string }[] =
  storageLocationTypes.map((type) => ({
    value: type,
    label: formatStorageLocationType(type),
  }));

// ============================================
// Component
// ============================================

interface StorageLocationFormProps {
  /** Existing storage location data for editing (undefined for create mode) */
  storageLocation?: StorageLocation;
  /** Form submission handler */
  onSubmit: (data: StorageLocationFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
  /** Pre-selected facility ID (for creating from facility context) */
  defaultFacilityId?: string;
}

export function StorageLocationForm({
  storageLocation,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
  defaultFacilityId,
}: StorageLocationFormProps) {
  const isEditMode = !!storageLocation;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<StorageLocationFormData>({
    resolver: zodResolver(storageLocationFormSchema),
    defaultValues: {
      code: storageLocation?.code ?? "",
      name: storageLocation?.name ?? "",
      type: storageLocation?.type ?? undefined,
      facilityId: storageLocation?.facilityId ?? defaultFacilityId ?? "",
      capacityKg: storageLocation?.capacityKg ?? undefined,
      latitude: storageLocation?.latitude ?? undefined,
      longitude: storageLocation?.longitude ?? undefined,
      storageMethod: storageLocation?.storageMethod ?? "",
      storageDescription: storageLocation?.storageDescription ?? "",
      supplierReferenceId: storageLocation?.supplierReferenceId ?? "",
    },
  });

  const defaultSubmitLabel = isEditMode
    ? "Update Storage Location"
    : "Create Storage Location";

  const handleFormSubmit = handleSubmit((data) => {
    // Cast to StorageLocationFormData since zodResolver validates the data
    onSubmit(data as StorageLocationFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Required Fields Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Required Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="code"
            label="Location Code"
            error={errors.code?.message}
          >
            <FormInput
              id="code"
              type="text"
              placeholder="Auto-generated if empty"
              disabled={isSubmitting}
              error={!!errors.code}
              {...register("code")}
            />
          </FormField>

          <FormField
            id="name"
            label="Location Name"
            error={errors.name?.message}
          >
            <FormInput
              id="name"
              type="text"
              placeholder="e.g., Feedstock Bin 1"
              disabled={isSubmitting}
              error={!!errors.name}
              {...register("name")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormEntitySelect
            control={control}
            name="facilityId"
            label="Facility"
            entityType="facility"
            placeholder="Select a facility..."
            disabled={isSubmitting}
          />

          <FormField
            id="type"
            label="Storage Type"
            error={errors.type?.message}
          >
            <FormSelect
              id="type"
              placeholder="Select storage type..."
              disabled={isSubmitting}
              error={!!errors.type}
              options={storageTypeOptions}
              {...register("type")}
            />
          </FormField>
        </div>
      </div>

      {/* Capacity Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Capacity
        </h3>

        <FormField
          id="capacityKg"
          label="Capacity (kg)"
          error={errors.capacityKg?.message}
          helperText="Maximum storage capacity in kilograms"
        >
          <FormInput
            id="capacityKg"
            type="number"
            step="any"
            placeholder="e.g., 5000"
            disabled={isSubmitting}
            error={!!errors.capacityKg}
            {...register("capacityKg", {
              setValueAs: (v) =>
                v === "" || v === null || v === undefined
                  ? undefined
                  : parseFloat(v),
            })}
          />
        </FormField>
      </div>

      {/* Location Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          GPS Coordinates (Optional)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="latitude"
            label="Latitude"
            error={errors.latitude?.message}
            helperText="Between -90 and 90"
          >
            <FormInput
              id="latitude"
              type="number"
              step="any"
              placeholder="e.g., -1.2921"
              disabled={isSubmitting}
              error={!!errors.latitude}
              {...register("latitude", {
                setValueAs: (v) =>
                  v === "" || v === null || v === undefined
                    ? undefined
                    : parseFloat(v),
              })}
            />
          </FormField>

          <FormField
            id="longitude"
            label="Longitude"
            error={errors.longitude?.message}
            helperText="Between -180 and 180"
          >
            <FormInput
              id="longitude"
              type="number"
              step="any"
              placeholder="e.g., 36.8219"
              disabled={isSubmitting}
              error={!!errors.longitude}
              {...register("longitude", {
                setValueAs: (v) =>
                  v === "" || v === null || v === undefined
                    ? undefined
                    : parseFloat(v),
              })}
            />
          </FormField>
        </div>
      </div>

      {/* Storage Details Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Storage Details (Optional)
        </h3>

        <FormField
          id="storageMethod"
          label="Storage Method"
          error={errors.storageMethod?.message}
        >
          <FormInput
            id="storageMethod"
            type="text"
            placeholder="e.g., Covered, Open, Indoor"
            disabled={isSubmitting}
            error={!!errors.storageMethod}
            {...register("storageMethod")}
          />
        </FormField>

        <FormField
          id="storageDescription"
          label="Description"
          error={errors.storageDescription?.message}
        >
          <FormTextarea
            id="storageDescription"
            placeholder="Additional details about the storage location"
            disabled={isSubmitting}
            error={!!errors.storageDescription}
            {...register("storageDescription")}
          />
        </FormField>

        <FormField
          id="supplierReferenceId"
          label="Supplier Reference ID"
          error={errors.supplierReferenceId?.message}
          helperText="External reference from supplier system"
        >
          <FormInput
            id="supplierReferenceId"
            type="text"
            placeholder="e.g., SUP-REF-001"
            disabled={isSubmitting}
            error={!!errors.supplierReferenceId}
            {...register("supplierReferenceId")}
          />
        </FormField>
      </div>

      {/* Form Actions */}
      <div className="flex items-center justify-end gap-16 pt-20 border-t border-[var(--color-border-secondary)]">
        {onCancel && (
          <Button
            type="button"
            variant="default"
            onClick={onCancel}
            disabled={isSubmitting}
          >
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
