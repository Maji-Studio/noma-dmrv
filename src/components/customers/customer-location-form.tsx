/**
 * CustomerLocationForm component
 * Reusable customer location form with React Hook Form integration
 * Used in both create and edit views for customer locations
 */
"use client";

import { useLatchedSubmit } from "@/hooks/use-latched-submit";
import { facilityDistanceDefaults } from "@/lib/facility-distance-defaults";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { Notice } from "@/components/ui/notice";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useSaveRefusal, type SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { FACILITY_DISTANCE_REFUSAL_ALIASES } from "@/lib/facility-distance-changes";
import { isActionError } from "@/lib/action-error";
import { REGISTERED_SITE_LOCKED_FIELDS } from "@/lib/party-domain-errors";
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

/**
 * The reason a registered storage site froze this location, when the refusal is
 * that lock (a lock on one of the site's fields), not any other certification lock.
 */
function storageSiteLockReason(error: unknown): string | null {
  if (!isActionError(error)) return null;
  const frozen: readonly unknown[] = REGISTERED_SITE_LOCKED_FIELDS;
  return error.issues.find((issue) => issue.code === "certification_locked" && issue.path.length === 1 && frozen.includes(issue.path[0]))?.message ?? null;
}

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
  /** Form submission handler; `onRefusal` shows a refused save at its fields (#1327). */
  onSubmit: (data: CustomerLocationFormData, onRefusal: SaveRefusalHandler) => Promise<void> | void;
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
  const latched = useLatchedSubmit();
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

  const formId = useId();
  // Registered locations are not a lock-read kind, so the storage-site refusal's
  // message is the lock. It stays until the dialog reopens or switches location
  // (the form remounts); the hook has already reverted the changed fields.
  const [siteLockReason, setSiteLockReason] = useState<string | null>(null);
  const refuseWithFields = useSaveRefusal({
    control: form.control,
    setError: form.setError,
    resetField: form.resetField,
    formId,
    aliases: FACILITY_DISTANCE_REFUSAL_ALIASES,
  });
  const refuseSave: SaveRefusalHandler = (error, fallback) => {
    const footer = refuseWithFields(error, fallback);
    const reason = storageSiteLockReason(error);
    if (reason) setSiteLockReason(reason);
    return footer;
  };
  const handleFormSubmit = latched(form.handleSubmit((data) => {
    return onSubmit(data, refuseSave);
  }));

  return (
    <form
      id={formId}
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
        siteLockReason={siteLockReason}
        isCurrentDefault={location?.isDefault === true}
        idPrefix={idPrefix}
        isEditMode={isEditMode}
        savedDistances={location?.facilityDistances}
      />

      <FormActions
        control={form.control}
        formId={formId}
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
