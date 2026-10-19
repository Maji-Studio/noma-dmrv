/**
 * CustomerLocationForm component
 * Reusable customer location form with React Hook Form integration
 * Used in both create and edit views for customer locations
 */
"use client";

import { facilityDistanceDefaults } from "@/lib/facility-distance-defaults";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { Notice } from "@/components/ui/notice";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormActions } from "@/components/forms";
import {
  customerLocationFormSchema,
  type CustomerLocationFormData,
  type CustomerLocationFormInput,
} from "@/schemas/customers";
import type { CustomerLocation } from "@/db/schema/parties";
import type { Facility } from "@/db/schema";
import { useOrganizationDefaultValues } from "@/hooks/use-organization-settings";
import { resolveLocationCountry } from "@/lib/location-defaults";
import { CustomerLocationFields } from "./customer-location-fields";

// ============================================
// Component
// ============================================

/** Fields the form pre-fills from: a saved location or a pending one. */
export type CustomerLocationInitialValues = Pick<CustomerLocation, "country"> &
  Partial<
    Pick<
      CustomerLocation,
      | "name"
      | "stateRegion"
      | "city"
      | "gpsLatitude"
      | "gpsLongitude"
      | "address"
      | "defaultSoilTemperatureC"
      | "isDefault"
    >
  > & { facilityDistances?: import("@/schemas/facility-distances").FacilityDistanceInput[] };

export type EditableCustomerLocation = Pick<
  CustomerLocation,
  | "name"
  | "country"
  | "stateRegion"
  | "city"
  | "gpsLatitude"
  | "gpsLongitude"
  | "address"
  | "facilityDistances"
  | "defaultSoilTemperatureC"
  | "isDefault"
> &
  Pick<
    CustomerLocation,
    | "id"
    | "updatedAt"
    // The integer version the dialog opened on, echoed back on save (issue #768).
    | "version"
  >;

interface CustomerLocationFormProps {
  /** Existing location data for editing (undefined for create mode) */
  location?: CustomerLocationInitialValues;
  facility?: Facility;
  /** Start "default" checked for a new location (the customer's first). */
  initialIsDefault?: boolean;
  /** Prefix field IDs when the form opens above another form with overlapping IDs. */
  idPrefix?: string;
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
  facility,
  initialIsDefault = false,
  idPrefix,
  onSubmit,
  onCancel,
  isSubmitting = false,
  errorMessage,
  submitLabel,
}: CustomerLocationFormProps) {
  const isEditMode = !!location;
  const { facilities } = useFacilityContext();
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
    facilityDistances: facilityDistanceDefaults(facility ? [facility] : facilities, location?.facilityDistances),
    defaultSoilTemperatureC: location?.defaultSoilTemperatureC ?? "",
    isDefault: location?.isDefault ?? initialIsDefault,
  };

  const form = useForm<
    CustomerLocationFormInput,
    unknown,
    CustomerLocationFormData
  >({
    resolver: zodResolver(customerLocationFormSchema),
    defaultValues,
  });

  const defaultSubmitLabel = isEditMode ? "Update location" : "Add location";

  const handleFormSubmit = form.handleSubmit((data) => {
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
      {isEditMode && <Notice tone="info">Saving fills a missing distance; never changes a recorded one.</Notice>}
      <CustomerLocationFields
        form={form}
        facility={facility}
        isSubmitting={isSubmitting}
        isCurrentDefault={location?.isDefault === true}
        idPrefix={idPrefix}
        isEditMode={isEditMode}
        savedDistances={location?.facilityDistances}
      />

      <FormActions
        control={form.control}
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
