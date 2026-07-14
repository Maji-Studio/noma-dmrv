/**
 * SupplierLocationForm component
 * Reusable supplier location form with structured address fields
 * Used in both create and edit views for supplier locations
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  DistanceCalcField,
  FormActions,
  FormField,
  FormInput,
  FormTextarea,
  PositionPicker,
} from "@/components/forms";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  supplierLocationFormSchema,
  type SupplierLocationFormData,
} from "@/schemas/suppliers";
import type { SupplierLocation } from "@/db/schema/parties";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";

// ============================================
// Component
// ============================================

interface SupplierLocationFormProps {
  /** Existing location data for editing (undefined for create mode) */
  location?: SupplierLocation;
  /** Form submission handler */
  onSubmit: (data: SupplierLocationFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function SupplierLocationForm({
  location,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: SupplierLocationFormProps) {
  const isEditMode = !!location;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(supplierLocationFormSchema),
    defaultValues: {
      name: location?.name ?? "",
      country: location?.country ?? "",
      stateRegion: location?.stateRegion ?? "",
      city: location?.city ?? "",
      gpsLatitude: location?.gpsLatitude ?? undefined,
      gpsLongitude: location?.gpsLongitude ?? undefined,
      address: location?.address ?? "",
      distanceFromFacilityKm: location?.distanceFromFacilityKm ?? undefined,
      distanceSource: location?.distanceSource ?? null,
      isDefault: location?.isDefault ?? false,
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Location" : "Add Location";

  // Preprocessed Zod fields have `unknown` input types — narrow the watches.
  const gpsLatitude = watch("gpsLatitude") as number | null | undefined;
  const gpsLongitude = watch("gpsLongitude") as number | null | undefined;
  const distanceFromFacilityKm = watch("distanceFromFacilityKm") as number | null | undefined;
  const distanceSource = watch("distanceSource");

  // CALC endpoints: this source location → the globally selected facility.
  const { selectedFacility } = useFacilityContext();
  const locationPoint =
    gpsLatitude != null && gpsLongitude != null
      ? { lat: gpsLatitude, lng: gpsLongitude }
      : null;
  const facilityPoint =
    selectedFacility?.gpsLatitude != null && selectedFacility?.gpsLongitude != null
      ? { lat: selectedFacility.gpsLatitude, lng: selectedFacility.gpsLongitude }
      : null;

  const handleFormSubmit = handleSubmit((data) => {
    return onSubmit(data);
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
          helperText="e.g., Main Estate, Collection Point B"
        >
          <FormInput
            id="name"
            type="text"
            placeholder="e.g., Main Estate"
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

        <PositionPicker
          idPrefix="gps"
          label="Source location position"
          accent="orange"
          required
          latitude={gpsLatitude ?? null}
          longitude={gpsLongitude ?? null}
          onPositionChange={({ lat, lng }) => {
            setValue("gpsLatitude", lat ?? undefined, { shouldDirty: true, shouldValidate: true });
            setValue("gpsLongitude", lng ?? undefined, { shouldDirty: true, shouldValidate: true });
          }}
          latitudeError={errors.gpsLatitude?.message}
          longitudeError={errors.gpsLongitude?.message}
          disabled={isSubmitting}
        />
      </div>

      {/* Logistics Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Logistics
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <DistanceCalcField
            id="distanceFromFacilityKm"
            label="One-way distance to facility (per leg, km)"
            error={errors.distanceFromFacilityKm?.message}
            certifyRequired={isCertifyFormField("supplierLocation", "distanceFromFacilityKm")}
            helperText="One-way road distance from this source location to the facility. Return trips are doubled at emissions time (set the trip type on each feedstock delivery)."
            disabled={isSubmitting}
            distanceKm={distanceFromFacilityKm}
            distanceSource={distanceSource}
            onDistanceChange={(km, source) => {
              setValue("distanceFromFacilityKm", km ?? undefined, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setValue("distanceSource", source, { shouldDirty: true });
            }}
            origin={locationPoint}
            destination={facilityPoint}
            originLabel="source location position"
            destinationLabel="selected facility"
          />
        </div>

        <label
          htmlFor="isDefault"
          className="flex items-center gap-12 cursor-pointer"
        >
          <input
            type="checkbox"
            id="isDefault"
            className="h-[18px] w-[18px] border border-[var(--color-border-primary)] accent-[var(--clr-dark-purple)] cursor-pointer"
            disabled={isSubmitting}
            {...register("isDefault")}
          />
          <span className="body-medium text-[var(--color-text-primary)]">
            Set as default source location
          </span>
        </label>
      </div>

      <FormActions
        sticky={false}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
