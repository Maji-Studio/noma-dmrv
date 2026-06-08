/**
 * CustomerLocationForm component
 * Reusable customer location form with React Hook Form integration
 * Used in both create and edit views for customer locations
 */
"use client";

import { nullableNumericValue } from "@/lib/form-utils";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  customerLocationFormSchema,
  type CustomerLocationFormData,
} from "@/schemas/customers";
import type { CustomerLocation } from "@/db/schema/parties";

// ============================================
// Component
// ============================================

interface CustomerLocationFormProps {
  /** Existing location data for editing (undefined for create mode) */
  location?: CustomerLocation;
  /** Form submission handler */
  onSubmit: (data: CustomerLocationFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function CustomerLocationForm({
  location,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: CustomerLocationFormProps) {
  const isEditMode = !!location;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(customerLocationFormSchema),
    defaultValues: {
      name: location?.name ?? "",
      country: location?.country ?? "",
      stateRegion: location?.stateRegion ?? "",
      city: location?.city ?? "",
      gpsLatitude: location?.gpsLatitude ?? undefined,
      gpsLongitude: location?.gpsLongitude ?? undefined,
      address: location?.address ?? "",
      distanceFromFacilityKm: location?.distanceFromFacilityKm ?? undefined,
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Location" : "Add Location";

  const handleFormSubmit = handleSubmit((data) => {
    return onSubmit(data as CustomerLocationFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Location Details Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Location Details
        </h3>

        <FormField
          id="name"
          label="Location Name"
          error={errors.name?.message}
          required
        >
          <FormInput
            id="name"
            type="text"
            placeholder="e.g., Coffee Block A"
            disabled={isSubmitting}
            error={!!errors.name}
            {...register("name")}
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-20">
          <FormField
            id="country"
            label="Country"
            error={errors.country?.message}
            required
          >
            <FormInput
              id="country"
              type="text"
              placeholder="e.g., Tanzania"
              disabled={isSubmitting}
              error={!!errors.country}
              {...register("country")}
            />
          </FormField>

          <FormField
            id="stateRegion"
            label="State / Region"
            error={errors.stateRegion?.message}
          >
            <FormInput
              id="stateRegion"
              type="text"
              placeholder="e.g., Kilimanjaro"
              disabled={isSubmitting}
              error={!!errors.stateRegion}
              {...register("stateRegion")}
            />
          </FormField>

          <FormField
            id="city"
            label="City"
            error={errors.city?.message}
          >
            <FormInput
              id="city"
              type="text"
              placeholder="e.g., Moshi"
              disabled={isSubmitting}
              error={!!errors.city}
              {...register("city")}
            />
          </FormField>
        </div>

        <FormField
          id="address"
          label="Address / Description"
          error={errors.address?.message}
        >
          <FormTextarea
            id="address"
            placeholder="Additional address details or site description"
            disabled={isSubmitting}
            error={!!errors.address}
            {...register("address")}
          />
        </FormField>
      </div>

      {/* GPS Coordinates Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          GPS Coordinates
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="gpsLatitude"
            label="GPS Latitude"
            error={errors.gpsLatitude?.message}
            helperText="Between -90 and 90"
          >
            <FormInput
              id="gpsLatitude"
              type="number"
              step="any"
              placeholder="e.g., -3.3349"
              disabled={isSubmitting}
              error={!!errors.gpsLatitude}
              {...register("gpsLatitude", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>

          <FormField
            id="gpsLongitude"
            label="GPS Longitude"
            error={errors.gpsLongitude?.message}
            helperText="Between -180 and 180"
          >
            <FormInput
              id="gpsLongitude"
              type="number"
              step="any"
              placeholder="e.g., 37.3404"
              disabled={isSubmitting}
              error={!!errors.gpsLongitude}
              {...register("gpsLongitude", {
                setValueAs: nullableNumericValue,
              })}
            />
          </FormField>
        </div>
      </div>

      {/* Logistics Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Logistics
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="distanceFromFacilityKm"
            label="Distance from facility (km)"
            error={errors.distanceFromFacilityKm?.message}
            helperText="Road distance facility → site. Auto-fills the biochar distribution transport leg used for certification."
          >
            <FormInput
              id="distanceFromFacilityKm"
              type="number"
              step="any"
              min={0}
              placeholder="e.g., 120"
              disabled={isSubmitting}
              error={!!errors.distanceFromFacilityKm}
              {...register("distanceFromFacilityKm", {
                setValueAs: nullableNumericValue,
              })}
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
