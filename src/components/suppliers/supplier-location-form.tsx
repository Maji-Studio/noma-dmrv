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
  FormSection,
  FormTextarea,
  PositionPicker,
  makeCertFieldStatus,
} from "@/components/forms";
import { useFacilityContext } from "@/hooks/use-facility-context";
import {
  supplierLocationFormSchema,
  type SupplierLocationFormData,
} from "@/schemas/suppliers";
import type { SupplierLocation } from "@/db/schema/parties";
import { useOrganizationDefaultValues } from "@/hooks/use-organization-settings";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import { resolveLocationCountry } from "@/lib/location-defaults";

// ============================================
// Component
// ============================================

interface SupplierLocationFormProps {
  /** Existing location data for editing (undefined for create mode) */
  location?: SupplierLocation;
  /** Prefix field IDs when the form opens above another form with overlapping IDs. */
  idPrefix?: string;
  /** Form submission handler */
  onSubmit: (data: SupplierLocationFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Submission-level error shown with the action footer */
  errorMessage?: string;
  /** Custom label for the submit button */
  submitLabel?: string;
}

function fieldId(idPrefix: string | undefined, fieldName: string): string {
  return idPrefix ? `${idPrefix}-${fieldName}` : fieldName;
}

export function SupplierLocationForm({
  location,
  idPrefix,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
}: SupplierLocationFormProps) {
  const isEditMode = !!location;
  const { defaults: organizationDefaults } = useOrganizationDefaultValues();
  const defaultValues = {
    name: location?.name ?? "",
    country: resolveLocationCountry(
      location,
      organizationDefaults.defaultCountry,
    ),
    stateRegion: location?.stateRegion ?? "",
    city: location?.city ?? "",
    gpsLatitude: location?.gpsLatitude ?? undefined,
    gpsLongitude: location?.gpsLongitude ?? undefined,
    address: location?.address ?? "",
    distanceFromFacilityKm: location?.distanceFromFacilityKm ?? undefined,
    distanceSource: location?.distanceSource ?? null,
    isDefault: location?.isDefault ?? false,
  };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(supplierLocationFormSchema),
    defaultValues,
  });
  const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);

  const defaultSubmitLabel = isEditMode ? "Update Location" : "Add Location";

  // Preprocessed Zod fields have `unknown` input types — narrow the watches.
  const gpsLatitude = watch("gpsLatitude") as number | null | undefined;
  const gpsLongitude = watch("gpsLongitude") as number | null | undefined;
  const distanceFromFacilityKm = watch("distanceFromFacilityKm") as number | null | undefined;
  const distanceSource = watch("distanceSource");
  const nameId = fieldId(idPrefix, "name");
  const countryId = fieldId(idPrefix, "country");
  const stateRegionId = idPrefix
    ? fieldId(idPrefix, "state-region")
    : "stateRegion";
  const cityId = fieldId(idPrefix, "city");
  const addressId = fieldId(idPrefix, "address");
  const positionIdPrefix = fieldId(idPrefix, "gps");
  const distanceId = idPrefix
    ? fieldId(idPrefix, "distance")
    : "distanceFromFacilityKm";
  const defaultId = idPrefix ? fieldId(idPrefix, "default") : "isDefault";

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
    <form
      onSubmit={(event) => {
        event.stopPropagation();
        return handleFormSubmit(event);
      }}
      className="space-y-20"
    >
      {/* Location Details Section */}
      <FormSection title="Location details" divider={false}>
        <FormField
          id={nameId}
          label="Location name"
          error={errors.name?.message}
          helperText="e.g., Main Estate, Collection Point B"
        >
          <FormInput
            id={nameId}
            type="text"
            placeholder="e.g., Main Estate"
            disabled={isSubmitting}
            error={!!errors.name}
            {...register("name")}
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-16 gap-y-20">
          <FormField
            id={countryId}
            label="Country"
            error={errors.country?.message}
            required
          >
            <FormInput
              id={countryId}
              type="text"
              placeholder="e.g., Tanzania"
              disabled={isSubmitting}
              error={!!errors.country}
              {...register("country")}
            />
          </FormField>

          <FormField
            id={stateRegionId}
            label="State / region"
            error={errors.stateRegion?.message}
          >
            <FormInput
              id={stateRegionId}
              type="text"
              placeholder="e.g., Kilimanjaro"
              disabled={isSubmitting}
              error={!!errors.stateRegion}
              {...register("stateRegion")}
            />
          </FormField>

          <FormField
            id={cityId}
            label="City"
            error={errors.city?.message}
          >
            <FormInput
              id={cityId}
              type="text"
              placeholder="e.g., Moshi"
              disabled={isSubmitting}
              error={!!errors.city}
              {...register("city")}
            />
          </FormField>
        </div>

        <FormField
          id={addressId}
          label="Address / description"
          error={errors.address?.message}
        >
          <FormTextarea
            id={addressId}
            placeholder="Additional address details or site description"
            disabled={isSubmitting}
            error={!!errors.address}
            {...register("address")}
          />
        </FormField>
      </FormSection>

      {/* GPS Coordinates Section */}
      <FormSection title="GPS coordinates">
        <PositionPicker
          idPrefix={positionIdPrefix}
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
      </FormSection>

      {/* Logistics Section */}
      <FormSection title="Logistics">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <DistanceCalcField
            id={distanceId}
            label="One-way distance to facility (per leg, km)"
            error={errors.distanceFromFacilityKm?.message}
            certifyRequired={isCertifyFormField("supplierLocation", "distanceFromFacilityKm")}
            certifyStatus={certStatus("distanceFromFacilityKm")}
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
          htmlFor={defaultId}
          className="flex items-center gap-12 cursor-pointer"
        >
          <input
            type="checkbox"
            id={defaultId}
            className="h-[18px] w-[18px] border border-[var(--color-border-primary)] accent-[var(--clr-dark-purple)] cursor-pointer"
            disabled={isSubmitting}
            {...register("isDefault")}
          />
          <span className="body-medium text-[var(--color-text-primary)]">
            Set as default source location
          </span>
        </label>
      </FormSection>

      <FormActions
        sticky={false}
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
