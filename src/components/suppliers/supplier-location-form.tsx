/**
 * SupplierLocationForm component
 * Reusable supplier location form with structured address fields
 * Used in both create and edit views for supplier locations
 */
"use client";

import { useController, useForm } from "react-hook-form";
import type { FacilityDistanceInput } from "@/schemas/facility-distances";
import { PartyFacilityDistances } from "@/components/party-facility-distances";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  FormActions,
  FormField,
  FormInput,
  FormSection,
  FormTextarea,
  PositionPicker,
} from "@/components/forms";
import {
  supplierLocationFormSchema,
  type SupplierLocationFormData,
} from "@/schemas/suppliers";
import type { SupplierLocation } from "@/db/schema/parties";
import { useOrganizationDefaultValues } from "@/hooks/use-organization-settings";
import { Notice } from "@/components/ui/notice";
import { resolveLocationCountry } from "@/lib/location-defaults";

// ============================================
// Component
// ============================================

/** Fields the form pre-fills from: a saved location or a pending one. */
export type SupplierLocationInitialValues = Pick<SupplierLocation, "country"> &
  Partial<
    Pick<
      SupplierLocation,
      | "name"
      | "stateRegion"
      | "city"
      | "gpsLatitude"
      | "gpsLongitude"
      | "address"
      | "isDefault"
    >
  > & { facilityDistances?: FacilityDistanceInput[] };

interface SupplierLocationFormProps {
  /** Existing location data for editing (undefined for create mode) */
  location?: SupplierLocationInitialValues;
  /** Start "default" checked for a new location (the party's first). */
  initialIsDefault?: boolean;
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
  initialIsDefault = false,
  idPrefix,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
}: SupplierLocationFormProps) {
  const isEditMode = !!location;
  // The default moves only by setting another location as default.
  const isCurrentDefault = location?.isDefault === true;
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
    facilityDistances: location?.facilityDistances ?? [],
    isDefault: location?.isDefault ?? initialIsDefault,
  };

  const {
    control,
    getValues,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(supplierLocationFormSchema),
    defaultValues,
  });

  const defaultSubmitLabel = isEditMode ? "Update location" : "Add location";

  // Preprocessed Zod fields have `unknown` input types — narrow the values.
  const { field: gpsLatitudeField } = useController({
    control,
    name: "gpsLatitude",
  });
  const { field: gpsLongitudeField } = useController({
    control,
    name: "gpsLongitude",
  });
  const { field: facilityDistancesField } = useController({ control, name: "facilityDistances" });
  const gpsLatitude = gpsLatitudeField.value as number | null | undefined;
  const gpsLongitude = gpsLongitudeField.value as number | null | undefined;
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
  const locationPoint =
    gpsLatitude != null && gpsLongitude != null
      ? { lat: gpsLatitude, lng: gpsLongitude }
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
      {isEditMode && <Notice tone="info">Existing transport legs keep their recorded distances.</Notice>}
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
            gpsLatitudeField.onChange(lat);
            gpsLongitudeField.onChange(lng);
          }}
          latitudeError={errors.gpsLatitude?.message}
          longitudeError={errors.gpsLongitude?.message}
          disabled={isSubmitting}
        />
      </FormSection>

      {/* Logistics Section */}
      <FormSection title="Logistics">
        <PartyFacilityDistances
          idPrefix={distanceId}
          value={facilityDistancesField.value as FacilityDistanceInput[] | undefined}
          getValue={() => getValues("facilityDistances") as FacilityDistanceInput[] | undefined}
          onChange={facilityDistancesField.onChange}
          locationPoint={locationPoint}
          disabled={isSubmitting}
          error={errors.facilityDistances?.message}
          rowErrors={errors.facilityDistances}
        />

        <div className="flex flex-col gap-4">
          <label
            htmlFor={defaultId}
            className="flex items-center gap-12 cursor-pointer"
          >
            <input
              type="checkbox"
              id={defaultId}
              className="h-[18px] w-[18px] border border-[var(--color-border-primary)] accent-[var(--clr-dark-purple)] cursor-pointer"
              disabled={isSubmitting || isCurrentDefault}
              {...register("isDefault")}
            />
            <span className="body-medium text-[var(--color-text-primary)]">
              Set as default source location
            </span>
          </label>
          {isCurrentDefault ? (
            <p className="body-caption text-[var(--color-text-tertiary)]">
              To change the default, set another location as default.
            </p>
          ) : null}
        </div>
      </FormSection>

      <FormActions
        control={control}
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
