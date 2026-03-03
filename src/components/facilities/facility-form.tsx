/**
 * FacilityForm component
 * Reusable facility form with React Hook Form integration
 * Used in both create and edit slide-overs for facilities
 */
"use client";

import { numericValue } from "@/lib/form-utils";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormTextarea } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui";
import {
  facilityFormSchema,
  facilityTypes,
  timezones,
  durabilityOptions,
  type FacilityFormData,
  type FacilityType,
  type Timezone,
  type DurabilityOption,
} from "@/schemas/facilities";
import type { Facility } from "@/db/schema/facilities";

// ============================================
// Constants for select options
// ============================================

const facilityTypeOptions: readonly { value: string; label: string }[] =
  facilityTypes.map((type) => ({
    value: type,
    label: formatFacilityType(type),
  }));

const timezoneOptions: readonly { value: string; label: string }[] =
  timezones.map((tz) => ({
    value: tz,
    label: formatTimezone(tz),
  }));

const durabilityOptions_: readonly { value: string; label: string }[] =
  durabilityOptions.map((opt) => ({
    value: opt,
    label: formatDurabilityOption(opt),
  }));

// ============================================
// Formatting helpers
// ============================================

function formatFacilityType(type: FacilityType): string {
  const labels: Record<FacilityType, string> = {
    production: "Production",
    storage: "Storage",
    processing: "Processing",
    distribution: "Distribution",
  };
  return labels[type];
}

function formatTimezone(tz: Timezone): string {
  // Convert IANA timezone to human-readable format
  // e.g., "Africa/Nairobi" -> "Africa/Nairobi (EAT)"
  return tz.replace(/_/g, " ");
}

function formatDurabilityOption(opt: DurabilityOption): string {
  const labels: Record<DurabilityOption, string> = {
    "200_year": "200 Year",
    "1000_year": "1000 Year",
  };
  return labels[opt];
}

// ============================================
// Component
// ============================================

interface FacilityFormProps {
  /** Existing facility data for editing (undefined for create mode) */
  facility?: Facility;
  /** Form submission handler */
  onSubmit: (data: FacilityFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function FacilityForm({
  facility,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: FacilityFormProps) {
  const isEditMode = !!facility;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(facilityFormSchema),
    defaultValues: {
      name: facility?.name ?? "",
      country: facility?.country ?? "",
      location: facility?.location ?? "",
      address: facility?.address ?? "",
      gpsLatitude: facility?.gpsLatitude ?? undefined,
      gpsLongitude: facility?.gpsLongitude ?? undefined,
      contactEmail: facility?.contactEmail ?? "",
      contactPhone: facility?.contactPhone ?? "",
      defaultDurabilityOption:
        (facility?.defaultDurabilityOption as DurabilityOption) ?? "200_year",
      timezone: ((facility as Record<string, unknown>)?.timezone as Timezone) ?? undefined,
      facilityType: ((facility as Record<string, unknown>)?.facilityType as FacilityType) ?? undefined,
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Facility" : "Create Facility";

  const handleFormSubmit = handleSubmit((data) => {
    // Cast to FacilityFormData since zodResolver validates the data
    onSubmit(data as FacilityFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Required Fields Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Required Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="name" label="Facility Name" error={errors.name?.message}>
            <FormInput
              id="name"
              type="text"
              placeholder="e.g., Nairobi Production Facility"
              disabled={isSubmitting}
              error={!!errors.name}
              {...register("name")}
            />
          </FormField>
        </div>

        <FormField id="country" label="Country" error={errors.country?.message}>
          <FormInput
            id="country"
            type="text"
            placeholder="e.g., Kenya"
            disabled={isSubmitting}
            error={!!errors.country}
            {...register("country")}
          />
        </FormField>
      </div>

      {/* Facility Type & Configuration Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Configuration
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="facilityType"
            label="Facility Type"
            error={errors.facilityType?.message}
          >
            <FormSelect
              id="facilityType"
              placeholder="Select facility type..."
              disabled={isSubmitting}
              error={!!errors.facilityType}
              options={facilityTypeOptions}
              {...register("facilityType")}
            />
          </FormField>

          <FormField
            id="defaultDurabilityOption"
            label="Default Durability Option"
            error={errors.defaultDurabilityOption?.message}
          >
            <FormSelect
              id="defaultDurabilityOption"
              disabled={isSubmitting}
              error={!!errors.defaultDurabilityOption}
              options={durabilityOptions_}
              {...register("defaultDurabilityOption")}
            />
          </FormField>

          <FormField
            id="timezone"
            label="Timezone"
            error={errors.timezone?.message}
          >
            <FormSelect
              id="timezone"
              placeholder="Select timezone..."
              disabled={isSubmitting}
              error={!!errors.timezone}
              options={timezoneOptions}
              {...register("timezone")}
            />
          </FormField>
        </div>
      </div>

      {/* Address & Location Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Address & Location
        </h3>

        <FormField
          id="location"
          label="Location (optional)"
          error={errors.location?.message}
          helperText="Brief location description, e.g., city or region"
        >
          <FormInput
            id="location"
            type="text"
            placeholder="e.g., Nairobi, Kenya"
            disabled={isSubmitting}
            error={!!errors.location}
            {...register("location")}
          />
        </FormField>

        <FormField
          id="address"
          label="Address (optional)"
          error={errors.address?.message}
        >
          <FormTextarea
            id="address"
            placeholder="Full street address"
            disabled={isSubmitting}
            error={!!errors.address}
            {...register("address")}
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="gpsLatitude"
            label="GPS Latitude (optional)"
            error={errors.gpsLatitude?.message}
            helperText="Between -90 and 90"
          >
            <FormInput
              id="gpsLatitude"
              type="number"
              step="any"
              placeholder="e.g., -1.2921"
              disabled={isSubmitting}
              error={!!errors.gpsLatitude}
              {...register("gpsLatitude", {
                setValueAs: numericValue,
              })}
            />
          </FormField>

          <FormField
            id="gpsLongitude"
            label="GPS Longitude (optional)"
            error={errors.gpsLongitude?.message}
            helperText="Between -180 and 180"
          >
            <FormInput
              id="gpsLongitude"
              type="number"
              step="any"
              placeholder="e.g., 36.8219"
              disabled={isSubmitting}
              error={!!errors.gpsLongitude}
              {...register("gpsLongitude", {
                setValueAs: numericValue,
              })}
            />
          </FormField>
        </div>
      </div>

      {/* Contact Information Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Contact Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="contactEmail"
            label="Contact Email (optional)"
            error={errors.contactEmail?.message}
          >
            <FormInput
              id="contactEmail"
              type="email"
              placeholder="e.g., facility@example.com"
              disabled={isSubmitting}
              error={!!errors.contactEmail}
              {...register("contactEmail")}
            />
          </FormField>

          <FormField
            id="contactPhone"
            label="Contact Phone (optional)"
            error={errors.contactPhone?.message}
            helperText="International format supported"
          >
            <FormInput
              id="contactPhone"
              type="tel"
              placeholder="e.g., +254 712 345678"
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
