/**
 * SupplierForm component
 * Reusable supplier form with React Hook Form integration
 * Used in both create and edit views for suppliers
 */
"use client";

import { nullableNumericValue } from "@/lib/form-utils";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  supplierFormSchema,
  type SupplierFormData,
} from "@/schemas/suppliers";
import type { Supplier } from "@/db/schema/parties";

// ============================================
// Component
// ============================================

interface SupplierFormProps {
  /** Existing supplier data for editing (undefined for create mode) */
  supplier?: Supplier;
  /** Form submission handler */
  onSubmit: (data: SupplierFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function SupplierForm({
  supplier,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: SupplierFormProps) {
  const isEditMode = !!supplier;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      name: supplier?.name ?? "",
      location: supplier?.location ?? "",
      gpsLatitude: supplier?.gpsLatitude ?? null,
      gpsLongitude: supplier?.gpsLongitude ?? null,
      address: supplier?.address ?? "",
      contactName: supplier?.contactName ?? "",
      contactEmail: supplier?.contactEmail ?? "",
      contactPhone: supplier?.contactPhone ?? "",
      sourceRegion: supplier?.sourceRegion ?? "",
      distanceToFacilityKm: supplier?.distanceToFacilityKm ?? undefined,
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Supplier" : "Create Supplier";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as SupplierFormData);
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
            id="name"
            label="Supplier Name"
            required
            error={errors.name?.message}
          >
            <FormInput
              id="name"
              type="text"
              placeholder="e.g., Agricultural Residues Co-op"
              disabled={isSubmitting}
              error={!!errors.name}
              {...register("name")}
            />
          </FormField>
        </div>
      </div>

      {/* Location Information Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Location Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="location"
            label="Location"
            error={errors.location?.message}
            helperText="General location or region of the supplier"
          >
            <FormInput
              id="location"
              type="text"
              placeholder="e.g., Northern Tanzania"
              disabled={isSubmitting}
              error={!!errors.location}
              {...register("location")}
            />
          </FormField>

          <FormField
            id="sourceRegion"
            label="Source Region"
            error={errors.sourceRegion?.message}
            helperText="Feedstock sourcing region (used for Isometric SC assessment)"
          >
            <FormInput
              id="sourceRegion"
              type="text"
              placeholder="e.g., Kilimanjaro"
              disabled={isSubmitting}
              error={!!errors.sourceRegion}
              {...register("sourceRegion")}
            />
          </FormField>

          <FormField
            id="distanceToFacilityKm"
            label="Distance to facility (km)"
            error={errors.distanceToFacilityKm?.message}
            helperText="Road distance to the delivery facility. Autofills a feedstock's transport leg (overridable per delivery)."
          >
            <FormInput
              id="distanceToFacilityKm"
              type="number"
              step="any"
              min={0}
              placeholder="e.g., 85"
              disabled={isSubmitting}
              error={!!errors.distanceToFacilityKm}
              {...register("distanceToFacilityKm", { setValueAs: nullableNumericValue })}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="gpsLatitude"
            label="GPS Latitude"
            error={errors.gpsLatitude?.message}
            helperText="-90 to 90"
            required
          >
            <FormInput
              id="gpsLatitude"
              type="number"
              step="any"
              placeholder="e.g., -3.3349"
              disabled={isSubmitting}
              error={!!errors.gpsLatitude}
              {...register("gpsLatitude", { setValueAs: nullableNumericValue })}
            />
          </FormField>

          <FormField
            id="gpsLongitude"
            label="GPS Longitude"
            error={errors.gpsLongitude?.message}
            helperText="-180 to 180"
            required
          >
            <FormInput
              id="gpsLongitude"
              type="number"
              step="any"
              placeholder="e.g., 37.3404"
              disabled={isSubmitting}
              error={!!errors.gpsLongitude}
              {...register("gpsLongitude", { setValueAs: nullableNumericValue })}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <div className="md:col-span-2">
            <FormField
              id="address"
              label="Address"
              error={errors.address?.message}
            >
              <FormTextarea
                id="address"
                placeholder="Supplier yard, collection center, or cooperative address"
                disabled={isSubmitting}
                error={!!errors.address}
                {...register("address")}
              />
            </FormField>
          </div>
        </div>
      </div>

      {/* Contact Information Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Contact Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="contactName"
            label="Contact Name"
            error={errors.contactName?.message}
          >
            <FormInput
              id="contactName"
              type="text"
              placeholder="e.g., Feedstock Coordinator"
              disabled={isSubmitting}
              error={!!errors.contactName}
              {...register("contactName")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="contactEmail"
            label="Contact Email"
            error={errors.contactEmail?.message}
          >
            <FormInput
              id="contactEmail"
              type="email"
              placeholder="e.g., procurement.partner@example.com"
              disabled={isSubmitting}
              error={!!errors.contactEmail}
              {...register("contactEmail")}
            />
          </FormField>

          <FormField
            id="contactPhone"
            label="Contact Phone"
            error={errors.contactPhone?.message}
            helperText="International format supported"
          >
            <FormInput
              id="contactPhone"
              type="tel"
              placeholder="e.g., +255 754 000 000"
              disabled={isSubmitting}
              error={!!errors.contactPhone}
              {...register("contactPhone")}
            />
          </FormField>
        </div>
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
