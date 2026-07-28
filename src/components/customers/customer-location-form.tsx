/**
 * CustomerLocationForm component
 * Reusable customer location form with React Hook Form integration
 * Used in both create and edit views for customer locations
 */
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormActions, makeCertFieldStatus } from "@/components/forms";
import {
  customerLocationFormSchema,
  type CustomerLocationFormData,
  type CustomerLocationFormInput,
} from "@/schemas/customers";
import type { CustomerLocation } from "@/db/schema/parties";
import { useOrganizationDefaultValues } from "@/hooks/use-organization-settings";
import { resolveLocationCountry } from "@/lib/location-defaults";
import { CustomerLocationFields } from "./customer-location-fields";

// ============================================
// Component
// ============================================

interface CustomerLocationFormProps {
  /** Existing location data for editing (undefined for create mode) */
  location?: CustomerLocation;
  /** Form submission handler */
  onSubmit: (data: CustomerLocationFormData) => Promise<void> | void;
  /** Cancel button handler */
  onCancel?: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Submission-level error shown with the action footer */
  errorMessage?: string;
  /** Custom label for the submit button */
  submitLabel?: string;
}

export function CustomerLocationForm({
  location,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
}: CustomerLocationFormProps) {
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
    defaultSoilTemperatureC: location?.defaultSoilTemperatureC ?? undefined,
    isDefault: location?.isDefault ?? false,
  };

  const form = useForm<
    CustomerLocationFormInput,
    unknown,
    CustomerLocationFormData
  >({
    resolver: zodResolver(customerLocationFormSchema),
    defaultValues,
  });
  const certStatus = makeCertFieldStatus(isEditMode ? defaultValues : undefined);

  const defaultSubmitLabel = isEditMode ? "Update Location" : "Add Location";

  const handleFormSubmit = form.handleSubmit((data) => {
    return onSubmit(data);
  });

  return (
    <form onSubmit={handleFormSubmit} className="space-y-20">
      <CustomerLocationFields
        form={form}
        isSubmitting={isSubmitting}
        certStatus={certStatus}
      />

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
