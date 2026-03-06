"use client";

import { numericValue } from "@/lib/form-utils";
import { formatTimezoneLabel } from "@/lib/date-utils";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui";
import {
  facilityFormSchema,
  timezones,
  type FacilityFormData,
  type Timezone,
} from "@/schemas/facilities";
import type { Facility } from "@/db/schema/facilities";

const timezoneOptions: readonly { value: string; label: string }[] =
  timezones.map((tz) => ({ value: tz, label: formatTimezoneLabel(tz) }));

type FacilityWithOptionalFields = Facility & { timezone?: string };

interface FacilityFormProps {
  facility?: FacilityWithOptionalFields;
  onSubmit: (data: FacilityFormData) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
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
      timezone: (facility?.timezone as Timezone) ?? undefined,
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Facility" : "Create Facility";

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as FacilityFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField id="name" label="Facility Name" error={errors.name?.message} required>
          <FormInput
            id="name"
            type="text"
            placeholder="e.g., Dark Earth Carbon Production Hub"
            disabled={isSubmitting}
            error={!!errors.name}
            {...register("name")}
          />
        </FormField>

        <FormField id="country" label="Country" error={errors.country?.message} required>
          <FormInput
            id="country"
            type="text"
            placeholder="e.g., Tanzania"
            disabled={isSubmitting}
            error={!!errors.country}
            {...register("country")}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-y-20">
        <FormField id="timezone" label="Timezone" error={errors.timezone?.message}>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField id="location" label="Location" error={errors.location?.message}>
          <FormInput
            id="location"
            type="text"
            placeholder="e.g., Moshi, Kilimanjaro Region"
            disabled={isSubmitting}
            error={!!errors.location}
            {...register("location")}
          />
        </FormField>

        <FormField id="address" label="Address" error={errors.address?.message}>
          <FormInput
            id="address"
            type="text"
            placeholder="e.g., Industrial Zone, Plot 42"
            disabled={isSubmitting}
            error={!!errors.address}
            {...register("address")}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField id="gpsLatitude" label="GPS Latitude" error={errors.gpsLatitude?.message}>
          <FormInput
            id="gpsLatitude"
            type="number"
            step="any"
            placeholder="e.g., -3.3349"
            disabled={isSubmitting}
            error={!!errors.gpsLatitude}
            {...register("gpsLatitude", { setValueAs: numericValue })}
          />
        </FormField>

        <FormField id="gpsLongitude" label="GPS Longitude" error={errors.gpsLongitude?.message}>
          <FormInput
            id="gpsLongitude"
            type="number"
            step="any"
            placeholder="e.g., 37.3404"
            disabled={isSubmitting}
            error={!!errors.gpsLongitude}
            {...register("gpsLongitude", { setValueAs: numericValue })}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField id="contactEmail" label="Contact Email" error={errors.contactEmail?.message}>
          <FormInput
            id="contactEmail"
            type="email"
            placeholder="e.g., operations@darkearthcarbon.com"
            disabled={isSubmitting}
            error={!!errors.contactEmail}
            {...register("contactEmail")}
          />
        </FormField>

        <FormField id="contactPhone" label="Contact Phone" error={errors.contactPhone?.message}>
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
