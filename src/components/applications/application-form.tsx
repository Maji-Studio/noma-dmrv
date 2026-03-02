/**
 * ApplicationForm component
 * Reusable application form with React Hook Form integration
 *
 * Form sections:
 * 1. Application Details — code, applicationDate, delivery, biocharAppliedTons, biocharAppliedDryTons
 * 2. Field Details — fieldSizeHa, fieldIdentifier, cropType, GPS coordinates
 * 3. Soil Temperature — soilTemperatureSource (enum toggle), soilTemperatureC
 * 4. Truck Weighing — truckMassOnArrivalKg, truckMassOnDepartureKg
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput, FormSelect } from "@/components/forms";
import { Button } from "@/components/ui";
import {
  applicationFormSchema,
  applicationMethods,
  soilTemperatureSources,
  formatApplicationMethod,
  formatSoilTemperatureSource,
  type ApplicationFormData,
  type ApplicationMethod,
  type SoilTemperatureSource,
} from "@/schemas/applications";
import type { Application } from "@/db/schema/application";

// ============================================
// Constants for select options
// ============================================

const applicationMethodOptions: readonly { value: string; label: string }[] = applicationMethods.map((method) => ({
  value: method,
  label: formatApplicationMethod(method as ApplicationMethod),
}));

const soilTemperatureSourceOptions: readonly { value: string; label: string }[] = soilTemperatureSources.map(
  (source) => ({
    value: source,
    label: formatSoilTemperatureSource(source as SoilTemperatureSource),
  }),
);

// ============================================
// Component
// ============================================

interface ApplicationFormProps {
  /** Existing application data for editing (undefined for create mode) */
  application?: Application;
  /** Available deliveries for selection */
  deliveries?: Array<{ id: string; deliveryDate: Date | string }>;
  /** Form submission handler */
  onSubmit: (data: ApplicationFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function ApplicationForm({
  application,
  deliveries = [],
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel,
}: ApplicationFormProps) {
  const isEditMode = !!application;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(applicationFormSchema),
    defaultValues: {
      code: application?.code ?? "",
      applicationDate: application?.applicationDate
        ? new Date(application.applicationDate).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0],
      deliveryId: application?.deliveryId ?? "",
      biocharAppliedTons: application?.biocharAppliedTons ?? undefined,
      biocharAppliedDryTons: application?.biocharAppliedDryTons ?? undefined,
      fieldSizeHa: application?.fieldSizeHa ?? undefined,
      fieldIdentifier: application?.fieldIdentifier ?? "",
      cropType: application?.cropType ?? "",
      gpsLatitude: application?.gpsLatitude ?? undefined,
      gpsLongitude: application?.gpsLongitude ?? undefined,
      applicationMethodType: (application?.applicationMethodType as ApplicationMethod) ?? undefined,
      gisBoundaryReference: application?.gisBoundaryReference ?? "",
      soilTemperatureSource: (application?.soilTemperatureSource as SoilTemperatureSource) ?? undefined,
      soilTemperatureC: application?.soilTemperatureC ?? undefined,
      truckMassOnArrivalKg: application?.truckMassOnArrivalKg ?? undefined,
      truckMassOnDepartureKg: application?.truckMassOnDepartureKg ?? undefined,
    },
  });

  const defaultSubmitLabel = isEditMode ? "Update Application" : "Create Application";

  const deliveryOptions = deliveries.map((d) => ({
    value: d.id,
    label: new Date(d.deliveryDate).toLocaleDateString(),
  }));

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-20">
      {/* === Section 1: Application Details === */}
      <div className="space-y-20">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Application Details
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="code" label="Application Code" error={errors.code?.message}>
            <FormInput
              id="code"
              type="text"
              placeholder="Auto-generated if empty"
              disabled={isSubmitting}
              error={!!errors.code}
              {...register("code")}
            />
          </FormField>

          <FormField id="applicationDate" label="Application Date" error={errors.applicationDate?.message}>
            <FormInput
              id="applicationDate"
              type="date"
              disabled={isSubmitting}
              error={!!errors.applicationDate}
              {...register("applicationDate")}
            />
          </FormField>
        </div>

        <FormField id="deliveryId" label="Delivery" error={errors.deliveryId?.message}>
          <FormSelect
            id="deliveryId"
            placeholder="Select delivery..."
            disabled={isSubmitting}
            error={!!errors.deliveryId}
            options={deliveryOptions}
            {...register("deliveryId")}
          />
        </FormField>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="biocharAppliedTons" label="Biochar Applied (Tons)" error={errors.biocharAppliedTons?.message}>
            <FormInput
              id="biocharAppliedTons"
              type="number"
              step="any"
              placeholder="e.g., 10.5"
              disabled={isSubmitting}
              error={!!errors.biocharAppliedTons}
              {...register("biocharAppliedTons", {
                setValueAs: (v) => (v === "" || v === null || v === undefined ? undefined : parseFloat(v)),
              })}
            />
          </FormField>

          <FormField
            id="biocharAppliedDryTons"
            label="Biochar Applied Dry (Tons)"
            error={errors.biocharAppliedDryTons?.message}
          >
            <FormInput
              id="biocharAppliedDryTons"
              type="number"
              step="any"
              placeholder="e.g., 8.5"
              disabled={isSubmitting}
              error={!!errors.biocharAppliedDryTons}
              {...register("biocharAppliedDryTons", {
                setValueAs: (v) => (v === "" || v === null || v === undefined ? undefined : parseFloat(v)),
              })}
            />
          </FormField>
        </div>
      </div>

      {/* === Section 2: Field Details === */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Field Details
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="fieldSizeHa" label="Field Size (Ha)" error={errors.fieldSizeHa?.message}>
            <FormInput
              id="fieldSizeHa"
              type="number"
              step="any"
              placeholder="e.g., 2.5"
              disabled={isSubmitting}
              error={!!errors.fieldSizeHa}
              {...register("fieldSizeHa", {
                setValueAs: (v) => (v === "" || v === null || v === undefined ? undefined : parseFloat(v)),
              })}
            />
          </FormField>

          <FormField
            id="fieldIdentifier"
            label="Field Identifier"
            error={errors.fieldIdentifier?.message}
            helperText="Field name or parcel ID"
          >
            <FormInput
              id="fieldIdentifier"
              type="text"
              placeholder="e.g., North Field A"
              disabled={isSubmitting}
              error={!!errors.fieldIdentifier}
              {...register("fieldIdentifier")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField id="cropType" label="Crop Type" error={errors.cropType?.message}>
            <FormInput
              id="cropType"
              type="text"
              placeholder="e.g., Maize"
              disabled={isSubmitting}
              error={!!errors.cropType}
              {...register("cropType")}
            />
          </FormField>

          <FormField
            id="applicationMethodType"
            label="Application Method"
            error={errors.applicationMethodType?.message}
          >
            <FormSelect
              id="applicationMethodType"
              placeholder="Select method..."
              disabled={isSubmitting}
              error={!!errors.applicationMethodType}
              options={applicationMethodOptions}
              {...register("applicationMethodType")}
            />
          </FormField>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="gpsLatitude"
            label="GPS Latitude"
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
                setValueAs: (v) => (v === "" || v === null || v === undefined ? undefined : parseFloat(v)),
              })}
            />
          </FormField>

          <FormField
            id="gpsLongitude"
            label="GPS Longitude"
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
                setValueAs: (v) => (v === "" || v === null || v === undefined ? undefined : parseFloat(v)),
              })}
            />
          </FormField>
        </div>

        <FormField
          id="gisBoundaryReference"
          label="GIS Boundary Reference"
          error={errors.gisBoundaryReference?.message}
          helperText="Link to GIS layer data"
        >
          <FormInput
            id="gisBoundaryReference"
            type="text"
            placeholder="e.g., https://gis.example.com/layer/123"
            disabled={isSubmitting}
            error={!!errors.gisBoundaryReference}
            {...register("gisBoundaryReference")}
          />
        </FormField>
      </div>

      {/* === Section 3: Soil Temperature === */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Soil Temperature
        </h3>
        <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">
          Isometric Protocol: Used in 200-year durability calculation
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="soilTemperatureSource"
            label="Temperature Source"
            error={errors.soilTemperatureSource?.message}
          >
            <FormSelect
              id="soilTemperatureSource"
              placeholder="Select source..."
              disabled={isSubmitting}
              error={!!errors.soilTemperatureSource}
              options={soilTemperatureSourceOptions}
              {...register("soilTemperatureSource")}
            />
          </FormField>

          <FormField
            id="soilTemperatureC"
            label="Soil Temperature (°C)"
            error={errors.soilTemperatureC?.message}
            helperText="Annual average for this application site"
          >
            <FormInput
              id="soilTemperatureC"
              type="number"
              step="any"
              placeholder="e.g., 25.0"
              disabled={isSubmitting}
              error={!!errors.soilTemperatureC}
              {...register("soilTemperatureC", {
                setValueAs: (v) => (v === "" || v === null || v === undefined ? undefined : parseFloat(v)),
              })}
            />
          </FormField>
        </div>
      </div>

      {/* === Section 4: Truck Weighing === */}
      <div className="space-y-20 pt-20 border-t border-[var(--color-border-tertiary)]">
        <h3 className="body-caption font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Truck Weighing
        </h3>
        <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)]">
          Isometric: BiocharApplication verification requirement
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-20">
          <FormField
            id="truckMassOnArrivalKg"
            label="Truck Mass on Arrival (kg)"
            error={errors.truckMassOnArrivalKg?.message}
          >
            <FormInput
              id="truckMassOnArrivalKg"
              type="number"
              step="any"
              placeholder="e.g., 15000"
              disabled={isSubmitting}
              error={!!errors.truckMassOnArrivalKg}
              {...register("truckMassOnArrivalKg", {
                setValueAs: (v) => (v === "" || v === null || v === undefined ? undefined : parseFloat(v)),
              })}
            />
          </FormField>

          <FormField
            id="truckMassOnDepartureKg"
            label="Truck Mass on Departure (kg)"
            error={errors.truckMassOnDepartureKg?.message}
          >
            <FormInput
              id="truckMassOnDepartureKg"
              type="number"
              step="any"
              placeholder="e.g., 5000"
              disabled={isSubmitting}
              error={!!errors.truckMassOnDepartureKg}
              {...register("truckMassOnDepartureKg", {
                setValueAs: (v) => (v === "" || v === null || v === undefined ? undefined : parseFloat(v)),
              })}
            />
          </FormField>
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex items-center justify-end gap-16 pt-20 border-t border-[var(--color-border-secondary)]">
        {onCancel && (
          <Button type="button" variant="default" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : (submitLabel ?? defaultSubmitLabel)}
        </Button>
      </div>
    </form>
  );
}
