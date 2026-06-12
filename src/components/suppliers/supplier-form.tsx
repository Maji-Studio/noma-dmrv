/**
 * SupplierForm component
 * Reusable supplier form with React Hook Form integration
 * Used in both create and edit views for suppliers
 */
"use client";

import { useForm, useWatch } from "react-hook-form";
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
  supplierFormSchema,
  type SupplierFormData,
} from "@/schemas/suppliers";
import type { Supplier } from "@/db/schema/parties";
import { isCertifyFormField } from "@/lib/certification/certify-field-registry";

// ============================================
// Component
// ============================================

interface SupplierFormProps {
  /** Existing supplier data for editing (undefined for create mode) */
  supplier?: Supplier;
  /** Form submission handler */
  onSubmit: (data: SupplierFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function SupplierForm({
  supplier,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: SupplierFormProps) {
  const isEditMode = !!supplier;

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      name: supplier?.name ?? "",
      location: supplier?.location ?? "",
      gpsLatitude: supplier?.gpsLatitude ?? null,
      gpsLongitude: supplier?.gpsLongitude ?? null,
      address: supplier?.address ?? "",
      contactName: supplier?.contactName ?? "",
      contactEmail: supplier?.contactEmail ?? "",
      contactPhone: supplier?.contactPhone ?? "",
      sourceRegion: supplier?.sourceRegion ?? "",
      distanceToFacilityKm: supplier?.distanceToFacilityKm ?? undefined,
      distanceSource: supplier?.distanceSource ?? null,
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Supplier" : "Create Supplier";

  // Preprocessed Zod fields have `unknown` input types — narrow the watches.
  const gpsLatitude = useWatch({ control, name: "gpsLatitude" }) as
    | number
    | null
    | undefined;
  const gpsLongitude = useWatch({ control, name: "gpsLongitude" }) as
    | number
    | null
    | undefined;
  const distanceToFacilityKm = useWatch({
    control,
    name: "distanceToFacilityKm",
  }) as number | null | undefined;
  const distanceSource = useWatch({ control, name: "distanceSource" });

  // CALC endpoints: supplier point → the globally selected facility.
  const { selectedFacility } = useFacilityContext();
  const supplierPoint =
    gpsLatitude != null && gpsLongitude != null
      ? { lat: gpsLatitude, lng: gpsLongitude }
      : null;
  const facilityPoint =
    selectedFacility?.gpsLatitude != null && selectedFacility?.gpsLongitude != null
      ? { lat: selectedFacility.gpsLatitude, lng: selectedFacility.gpsLongitude }
      : null;

  const handleFormSubmit = handleSubmit((data) => {
    onSubmit(data as SupplierFormData);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      {/* Required Fields Section */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Required Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="name"
            label="Supplier Name"
            required
            error={errors.name?.message}
          >
            <FormInput
              id="name"
              type="text"
              placeholder="e.g., Agricultural Residues Co-op"
              disabled={isSubmitting}
              error={!!errors.name}
              {...register("name")}
            />
          </FormField>
        </div>
      </div>

      {/* Location Information Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Location Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="location"
            label="Location"
            error={errors.location?.message}
            helperText="General location or region of the supplier"
          >
            <FormInput
              id="location"
              type="text"
              placeholder="e.g., Northern Tanzania"
              disabled={isSubmitting}
              error={!!errors.location}
              {...register("location")}
            />
          </FormField>

          <FormField
            id="sourceRegion"
            label="Source Region"
            error={errors.sourceRegion?.message}
            helperText="Feedstock sourcing region (used for Isometric SC assessment)"
          >
            <FormInput
              id="sourceRegion"
              type="text"
              placeholder="e.g., Kilimanjaro"
              disabled={isSubmitting}
              error={!!errors.sourceRegion}
              {...register("sourceRegion")}
            />
          </FormField>
        </div>

        <PositionPicker
          idPrefix="gps"
          label="Supplier position"
          accent="orange"
          required
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
          <div className="md:col-span-2">
            <FormField
              id="address"
              label="Address"
              error={errors.address?.message}
            >
              <FormTextarea
                id="address"
                placeholder="Supplier yard, collection center, or cooperative address"
                disabled={isSubmitting}
                error={!!errors.address}
                {...register("address")}
              />
            </FormField>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <DistanceCalcField
            id="distanceToFacilityKm"
            label="Default distance to facility (km)"
            error={errors.distanceToFacilityKm?.message}
            certifyRequired={isCertifyFormField("supplier", "distanceToFacilityKm")}
            helperText="Road distance to the delivery facility. Used when a supplier location has no distance of its own; autofills a feedstock's transport leg (overridable per delivery)."
            disabled={isSubmitting}
            distanceKm={distanceToFacilityKm}
            distanceSource={distanceSource}
            onDistanceChange={(km, source) => {
              setValue("distanceToFacilityKm", km ?? undefined, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setValue("distanceSource", source, { shouldDirty: true });
            }}
            origin={supplierPoint}
            destination={facilityPoint}
            originLabel="supplier position"
            destinationLabel="selected facility"
          />
        </div>
      </div>

      {/* Contact Information Section */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Contact Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="contactName"
            label="Contact Name"
            error={errors.contactName?.message}
          >
            <FormInput
              id="contactName"
              type="text"
              placeholder="e.g., Feedstock Coordinator"
              disabled={isSubmitting}
              error={!!errors.contactName}
              {...register("contactName")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="contactEmail"
            label="Contact Email"
            error={errors.contactEmail?.message}
          >
            <FormInput
              id="contactEmail"
              type="email"
              placeholder="e.g., procurement.partner@example.com"
              disabled={isSubmitting}
              error={!!errors.contactEmail}
              {...register("contactEmail")}
            />
          </FormField>

          <FormField
            id="contactPhone"
            label="Contact Phone"
            error={errors.contactPhone?.message}
            helperText="International format supported"
          >
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
      </div>

      <FormActions
        onCancel={onCancel}
        isSubmitting={isSubmitting}
        submitLabel={submitLabel}
        defaultSubmitLabel={defaultSubmitLabel}
      />
    </form>
  );
}
