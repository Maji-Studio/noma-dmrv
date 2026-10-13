"use client";


import { ONE_WAY_EACH_DELIVERY_CUE, oneWayDistanceCue } from "@/lib/format-utils";
import { useController, type UseFormReturn } from "react-hook-form";
import {
  DistanceCalcField,
  FormField,
  FormInput,
  FormSection,
  FormTextarea,
  PositionPicker,
  type CertFieldStatus,
} from "@/components/forms";
import { useFacilityContext } from "@/hooks/use-facility-context";
import type { Facility } from "@/db/schema";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";
import type {
  CustomerLocationFormData,
  CustomerLocationFormInput,
} from "@/schemas/customers";

type CustomerLocationFormApi = UseFormReturn<
  CustomerLocationFormInput,
  unknown,
  CustomerLocationFormData
>;

interface CustomerLocationFieldsProps {
  form: CustomerLocationFormApi;
  /** Calculation origin; standalone callers fall back to the selected facility. */
  facility?: Facility;
  isSubmitting?: boolean;
  /** The edited location is the party's default; it stays checked until another is set. */
  isCurrentDefault?: boolean;
  idPrefix?: string;
  certStatus?: (fieldName: string) => CertFieldStatus;
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
  certStatus = () => "neutral",
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
  const { field: distanceFromFacilityField } = useController({
    control,
    name: "distanceFromFacilityKm",
  });
  const { field: distanceSourceField } = useController({
    control,
    name: "distanceSource",
  });
  const gpsLatitude = gpsLatitudeField.value as number | null | undefined;
  const gpsLongitude = gpsLongitudeField.value as number | null | undefined;
  const distanceFromFacilityKm = distanceFromFacilityField.value as
    | number
    | null
    | undefined;
  const distanceSource = distanceSourceField.value;

  // CALC endpoints: the caller's facility (or global selection) → this site.
  const { selectedFacility } = useFacilityContext();
  const originFacility = facility ?? selectedFacility;
  const locationPoint =
    gpsLatitude != null && gpsLongitude != null
      ? { lat: gpsLatitude, lng: gpsLongitude }
      : null;
  const facilityPoint =
    originFacility?.gpsLatitude != null &&
    originFacility?.gpsLongitude != null
      ? {
          lat: originFacility.gpsLatitude,
          lng: originFacility.gpsLongitude,
        }
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
    : "distanceFromFacilityKm";
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
            step="any"
            placeholder="e.g., 24.5"
            disabled={isSubmitting}
            error={!!errors.defaultSoilTemperatureC}
            {...register("defaultSoilTemperatureC")}
          />
        </FormField>
      </FormSection>

      <FormSection title="Logistics">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <DistanceCalcField
            id={distanceId}
            label="Distance from facility"
            error={errors.distanceFromFacilityKm?.message}
            certifyRequired={isCertifyFormField(
              "customerLocation",
              "distanceFromFacilityKm",
            )}
            certifyStatus={certStatus("distanceFromFacilityKm")}
            helperText="One-way road distance to this site. Every delivery counts the round trip, twice this distance, in emissions."
            cue={oneWayDistanceCue(distanceFromFacilityKm, ONE_WAY_EACH_DELIVERY_CUE)}
            disabled={isSubmitting}
            distanceKm={distanceFromFacilityKm}
            distanceSource={distanceSource}
            onDistanceChange={(km, source) => {
              // `null` is the explicit clear; `undefined` would read as
              // "field omitted" and leave the stored distance in place.
              distanceFromFacilityField.onChange(km);
              distanceSourceField.onChange(source);
            }}
            origin={facilityPoint}
            destination={locationPoint}
            originLabel={facility ? `facility ${facility.name}` : "selected facility"}
            destinationLabel="application site position"
          />
        </div>

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
