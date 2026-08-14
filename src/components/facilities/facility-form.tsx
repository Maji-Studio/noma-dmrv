"use client";

import { useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  FormActions,
  FormField,
  FormInput,
  PositionPicker,
  ResolvedErrorRevalidator,
} from "@/components/forms";
import {
  facilityFormSchema,
  timezones,
  type FacilityFormData,
  type Timezone,
} from "@/schemas/facilities";
import {
  durabilityOptions,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import type { Facility } from "@/db/schema/facilities";
import {
  DurabilityTierSelect,
  FacilityIsometricConnector,
} from "@/components/certification";
import { useOrganizationDefaultValues } from "@/hooks/use-organization-settings";
import { TimezoneCombobox } from "./timezone-combobox";

// 1000-year is the go-forward tier (ADR 0021); new facilities default to it.
const DEFAULT_DURABILITY_OPTION: DurabilityOption = "1000_year";

/**
 * A zone the picker actually offers, or `undefined`. Both the facility column
 * and the organization default are free text, so either can hold a zone this
 * list does not carry; seeding the select with one would leave it showing the
 * first option and silently save that instead.
 */
function resolveTimezone(zone: string | null | undefined): Timezone | undefined {
  return zone && timezones.includes(zone as Timezone)
    ? (zone as Timezone)
    : undefined;
}

function getDefaultDurabilityOption(
  option: Facility["durabilityOption"] | null | undefined
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
  errorMessage?: string;
  submitLabel?: string;
  cancelLabel?: string;
}

export function FacilityForm({
  facility,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
  cancelLabel,
}: FacilityFormProps) {
  const isEditMode = !!facility;
  // Organization operating defaults seed create mode only; an existing record
  // always wins. Warmed once per session in FacilityProvider, so this is a
  // cache read rather than a round trip on open.
  const { defaults: orgDefaults } = useOrganizationDefaultValues();

  const {
    register,
    handleSubmit,
    control,
    trigger,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(facilityFormSchema),
    defaultValues: {
      name: facility?.name ?? "",
      country: facility?.country ?? orgDefaults.defaultCountry ?? "",
      location: facility?.location ?? "",
      address: facility?.address ?? "",
      gpsLatitude: facility?.gpsLatitude ?? undefined,
      gpsLongitude: facility?.gpsLongitude ?? undefined,
      contactEmail: facility?.contactEmail ?? "",
      contactPhone: facility?.contactPhone ?? "",
      timezone: resolveTimezone(facility?.timezone)
        ?? resolveTimezone(orgDefaults.defaultTimezone),
      durabilityOption: getDefaultDurabilityOption(
        facility?.durabilityOption,
      ),
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Facility" : "Create Facility";

  const gpsLatitude = watch("gpsLatitude");
  const gpsLongitude = watch("gpsLongitude");
  const timezone = watch("timezone") as Timezone | undefined;
  const durabilityOption = watch("durabilityOption") ?? DEFAULT_DURABILITY_OPTION;
  const timezoneField = register("timezone");

  // Re-entrancy latch against a rapid double-submit (QA: a double-click on
  // Create Facility created two facilities). The parent's `isSubmitting`
  // disables the button only after its async mutation state round-trips a
  // render, so two submits dispatched in the same tick both slip through before
  // the button disables. The latch is touched only inside this event handler
  // (never during render, per the React Compiler refs rule); microtask FIFO
  // ordering means the first validated submit sets it before the second's
  // validation resolves, and the `finally` re-arms it so a validation failure
  // or a settled mutation still allows a later legitimate resubmit.
  const submitLockRef = useRef(false);

  const handleFormSubmit = handleSubmit(async (data) => {
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    try {
      await onSubmit(data as FacilityFormData);
    } finally {
      submitLockRef.current = false;
    }
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
        <FormField id="name" label="Facility name" error={errors.name?.message} required>
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
          <TimezoneCombobox
            id="timezone"
            name={timezoneField.name}
            inputRef={timezoneField.ref}
            value={timezone}
            onChange={(value) =>
              setValue("timezone", value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            onBlur={() =>
              setValue("timezone", timezone, {
                shouldTouch: true,
              })
            }
            disabled={isSubmitting}
            error={!!errors.timezone}
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
        <FormField id="contactEmail" label="Contact email" error={errors.contactEmail?.message}>
          <FormInput
            id="contactEmail"
            type="email"
            placeholder="e.g., operations@darkearthcarbon.com"
            disabled={isSubmitting}
            error={!!errors.contactEmail}
            {...register("contactEmail")}
          />
        </FormField>

        <FormField id="contactPhone" label="Contact phone" error={errors.contactPhone?.message}>
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
          id="durabilityOption"
          label="Durability tier"
          error={errors.durabilityOption?.message}
          hint="Set once for your registry program and inherited by every credit batch and Sample at this facility. The 200-year pathway opens when a 200-year client onboards."
        >
          <DurabilityTierSelect
            value={durabilityOption}
            onChange={(value) =>
              setValue("durabilityOption", value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            disabled={isSubmitting}
            aria-label="Facility durability tier"
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
        control={control}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
        cancelLabel={cancelLabel}
      />
    </form>
  );
}
