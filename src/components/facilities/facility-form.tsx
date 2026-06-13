"use client";

import { formatTimezoneLabel } from "@/lib/date-utils";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, PositionPicker, FormActions } from "@/components/forms";
import { FormSelect } from "@/components/forms/form-select";
import {
  facilityFormSchema,
  timezones,
  type FacilityFormData,
  type Timezone,
} from "@/schemas/facilities";
import {
  durabilityOptions,
  formatDurabilityOption,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import type { Facility } from "@/db/schema/facilities";
import { FacilityIsometricConnector } from "@/components/certification";

const DEFAULT_DURABILITY_OPTION: DurabilityOption = "200_year";

const timezoneOptions: readonly { value: string; label: string }[] =
  timezones.map((tz) => ({ value: tz, label: formatTimezoneLabel(tz) }));

const durabilityOptionList: readonly { value: string; label: string }[] =
  durabilityOptions.map((option) => ({
    value: option,
    label: formatDurabilityOption(option as DurabilityOption),
  }));

function getDefaultDurabilityOption(
  option: Facility["defaultDurabilityOption"] | null | undefined
): DurabilityOption {
  return durabilityOptions.includes(option as DurabilityOption)
    ? (option as DurabilityOption)
    : DEFAULT_DURABILITY_OPTION;
}

interface FacilityFormProps {
  facility?: Facility;
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
    watch,
    setValue,
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
      timezone: (facility?.timezone && timezones.includes(facility.timezone as Timezone)
        ? facility.timezone as Timezone
        : undefined),
      defaultDurabilityOption: getDefaultDurabilityOption(
        facility?.defaultDurabilityOption,
      ),
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Facility" : "Create Facility";

  const gpsLatitude = watch("gpsLatitude");
  const gpsLongitude = watch("gpsLongitude");

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
        <FormField
          id="timezone"
          label="Timezone"
          error={errors.timezone?.message}
          required
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

      <PositionPicker
        idPrefix="gps"
        label="Facility position"
        accent="purple"
        latitude={gpsLatitude ?? null}
        longitude={gpsLongitude ?? null}
        onPositionChange={({ lat, lng }) => {
          setValue("gpsLatitude", lat, { shouldDirty: true, shouldValidate: true });
          setValue("gpsLongitude", lng, { shouldDirty: true, shouldValidate: true });
        }}
        latitudeError={errors.gpsLatitude?.message}
        longitudeError={errors.gpsLongitude?.message}
        disabled={isSubmitting}
      />

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

      <div className="grid grid-cols-1 gap-y-20">
        <FormField
          id="defaultDurabilityOption"
          label="Default Durability Option"
          error={errors.defaultDurabilityOption?.message}
          hint="Isometric crediting tier for this facility's credit batches. New batches inherit this project-level PDD decision; existing batches keep their original option. 1000-year additionally requires reflectance lab data."
        >
          <FormSelect
            id="defaultDurabilityOption"
            disabled={isSubmitting}
            error={!!errors.defaultDurabilityOption}
            options={durabilityOptionList}
            {...register("defaultDurabilityOption")}
          />
        </FormField>
      </div>

      {/* Registry connection — edit-mode only (needs a facility id; the
          post-create link dialog covers new facilities). Self-contained:
          saves immediately via its own admin-gated action, independent of
          this form's submit. */}
      {isEditMode && facility && (
        <FacilityIsometricConnector facilityId={facility.id} />
      )}

      <FormActions
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
