"use client";


import type { FacilityDistanceInput } from "@/schemas/facility-distances";
import { PartyFacilityDistances } from "@/components/party-facility-distances";
import { useController, type UseFormReturn } from "react-hook-form";
import {
  FormField,
  FormInput,
  FormSection,
  FormTextarea,
  PositionPicker,
} from "@/components/forms";
import type { Facility } from "@/db/schema";
import { numberInputConstraintsFor } from "@/lib/number-input-constraints";
import {
  customerLocationFormSchema,
  type CustomerLocationFormData,
  type CustomerLocationFormInput,
} from "@/schemas/customers";

/** Native min, max and step for the soil temperature, read from the schema. */
const SOIL_TEMPERATURE_BOUNDS = numberInputConstraintsFor(customerLocationFormSchema)("defaultSoilTemperatureC");

type CustomerLocationFormApi = UseFormReturn<
  CustomerLocationFormInput,
  unknown,
  CustomerLocationFormData
>;

interface CustomerLocationFieldsProps {
  form: CustomerLocationFormApi;
  /** Contextual editors restrict distances to this facility; standalone forms show all active facilities. */
  facility?: Facility;
  isSubmitting?: boolean;
  /** The edited location is the party's default; it stays checked until another is set. */
  isCurrentDefault?: boolean;
  idPrefix?: string;
  isEditMode?: boolean;
  savedDistances?: FacilityDistanceInput[];
}

function fieldId(idPrefix: string | undefined, fieldName: string): string {
  return idPrefix ? `${idPrefix}-${fieldName}` : fieldName;
}

export function CustomerLocationFields({
  form,
  facility,
  isSubmitting = false,
  isCurrentDefault = false,
  idPrefix,
  isEditMode,
  savedDistances,
}: CustomerLocationFieldsProps) {
  const {
    register,
    control,
    formState: { errors },
  } = form;

  // Preprocessed Zod fields have `unknown` input types — narrow the watches.
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

  // Each facility row estimates its route to this site.
  const locationPoint =
    gpsLatitude != null && gpsLongitude != null
      ? { lat: gpsLatitude, lng: gpsLongitude }
      : null;

  const nameId = fieldId(idPrefix, "name");
  const countryId = fieldId(idPrefix, "country");
  const stateRegionId = fieldId(idPrefix, "state-region");
  const cityId = fieldId(idPrefix, "city");
  const addressId = fieldId(idPrefix, "address");
  const positionIdPrefix = fieldId(idPrefix, "gps");
  const soilTemperatureId = fieldId(idPrefix, "soil-temperature");
  const distanceId = idPrefix
    ? fieldId(idPrefix, "distance")
    : "facilityDistances";
  const defaultId = idPrefix ? fieldId(idPrefix, "default") : "isDefault";

  return (
    <>
      <FormSection title="Location details" divider={false}>
        <FormField
          id={nameId}
          label="Location name"
          error={errors.name?.message}
          required
        >
          <FormInput
            id={nameId}
            type="text"
            placeholder="e.g., Coffee Block A"
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

          <FormField id={cityId} label="City" error={errors.city?.message}>
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

        {/*
          Optional: the GPS position identifies the site. Rural application
          sites often have no postal address, so this is free text for whatever
          actually helps someone find the place.
        */}
        <FormField
          id={addressId}
          label="Site description"
          error={errors.address?.message}
        >
          <FormTextarea
            id={addressId}
            placeholder="Landmark, parcel name, access details, or street address"
            disabled={isSubmitting}
            error={!!errors.address}
            {...register("address")}
          />
        </FormField>
      </FormSection>

      <FormSection title="GPS coordinates">
        <PositionPicker
          idPrefix={positionIdPrefix}
          label="Application site position"
          accent="pink"
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

      <FormSection title="Soil defaults">
        <FormField
          id={soilTemperatureId}
          label="Default soil temperature (°C)"
          error={errors.defaultSoilTemperatureC?.message}
          helperText="Default for new applications; editable per application."
        >
          <FormInput
            id={soilTemperatureId}
            type="number"
            {...SOIL_TEMPERATURE_BOUNDS}
            placeholder="e.g., 24.5"
            disabled={isSubmitting}
            error={!!errors.defaultSoilTemperatureC}
            {...register("defaultSoilTemperatureC")}
          />
        </FormField>
      </FormSection>

      <FormSection title="Logistics">
        <PartyFacilityDistances
          isEditMode={isEditMode}
          savedValue={savedDistances}
          fromFacility
          idPrefix={distanceId}
          value={facilityDistancesField.value as FacilityDistanceInput[] | undefined}
          getValue={() => form.getValues("facilityDistances") as FacilityDistanceInput[] | undefined}
          onChange={facilityDistancesField.onChange}
          locationPoint={locationPoint}
          disabled={isSubmitting}
          error={errors.facilityDistances?.message}
          rowErrors={errors.facilityDistances}
          facility={facility}
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
              Set as default destination
            </span>
          </label>
          {isCurrentDefault ? (
            <p className="body-caption text-[var(--color-text-tertiary)]">
              To change the default, set another location as default.
            </p>
          ) : null}
        </div>
      </FormSection>
    </>
  );
}
