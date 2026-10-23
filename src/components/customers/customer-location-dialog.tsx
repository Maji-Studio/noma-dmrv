/**
 * Customer location dialog for creating and editing persisted locations.
 * Embeds the full CustomerLocationForm (RHF + Zod) inside QuickAddDialogShell
 * so validation stays centralized in `customerLocationFormSchema`.
 */
"use client";

import { useState } from "react";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import {
  useCreateCustomerLocation,
  useUpdateCustomerLocation,
} from "@/hooks/use-customers";
import { useToast } from "@/components/ui/toast";
import type { SaveRefusalHandler } from "@/components/forms/use-save-refusal";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { facilityDistanceChanges, withFormDistanceRows } from "@/lib/facility-distance-changes";
import type { CustomerLocationFormData } from "@/schemas/customers";
import type { Facility } from "@/db/schema";
import {
  CustomerLocationForm,
  type EditableCustomerLocation,
} from "./customer-location-form";

const CUSTOMER_LOCATION_DIALOG_ID_PREFIX = "customer-location-dialog";

// ============================================
// Types
// ============================================

interface CustomerLocationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  location?: EditableCustomerLocation;
  facility?: Facility;
  /** True when the party has no saved locations yet, so "default" starts checked. */
  isFirstLocation?: boolean;
}

// ============================================
// Component
// ============================================

export function CustomerLocationDialog({
  isOpen,
  onClose,
  customerId,
  location,
  facility,
  isFirstLocation = false,
}: CustomerLocationDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const createLocation = useCreateCustomerLocation();
  const updateLocation = useUpdateCustomerLocation();
  const toast = useToast();
  const isEditing = location !== undefined;

  // Modal unmounts its children while closed, so the embedded form resets on
  // every open. Only the dialog-level server error needs clearing.
  // Closing ends the draft, so the next open never reuses a key from a failed save.
  const handleClose = () => {
    setError(null);
    createLocation.startDraft();
    onClose();
  };

  const handleSubmit = async (data: CustomerLocationFormData, onRefusal: SaveRefusalHandler) => {
    setError(null);
    const submitted = facilityDistanceChanges(data.facilityDistances, location?.facilityDistances);
    try {
      const locationData = {
        name: data.name,
        country: data.country,
        stateRegion: data.stateRegion || null,
        city: data.city || null,
        address: data.address,
        gpsLatitude: data.gpsLatitude,
        gpsLongitude: data.gpsLongitude,
        facilityDistances: submitted,
        defaultSoilTemperatureC: data.defaultSoilTemperatureC,
        isDefault: data.isDefault,
      };

      let saved: { warnings?: string[] } | undefined;
      if (location) {
        saved = await updateLocation.mutateAsync({
          locationId: location.id,
          // The version the dialog opened on, so a concurrent edit is refused
          // instead of silently overwritten (#768).
          expectedVersion: location.version,
          ...locationData,
        });
      } else {
        saved = await createLocation.mutateAsync({
          customerId,
          ...locationData,
        });
      }
      handleClose();
      // The write committed: say what it changed besides the location itself
      // (default moved, distances filled).
      if (saved?.warnings?.length) toast.warning(saved.warnings.join(" "));
    } catch (err) {
      // The dialog stays open on every failure, so the operator's draft
      // survives an expected-version refusal untouched.
      setError(
        onRefusal(
          withFormDistanceRows(err, submitted, data.facilityDistances),
          toSaveErrorMessage(
            err,
            isEditing
              ? "Location was not saved. Try again."
              : "Location was not created. Check the form.",
          ),
        ),
      );
    }
  };

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? "Edit location" : "Add location"}
      width="lg"
      testId={
        isEditing ? "customer-location-edit-dialog" : "location-quick-add-dialog"
      }
    >
      <CustomerLocationForm
        // A new location starts a fresh form, so a lock on the last one does not carry over.
        key={location?.id ?? "new"}
        idPrefix={CUSTOMER_LOCATION_DIALOG_ID_PREFIX}
        location={location}
        facility={facility}
        initialIsDefault={isFirstLocation}
        onSubmit={handleSubmit}
        onCancel={handleClose}
        isSubmitting={
          isEditing ? updateLocation.isPending : createLocation.isPending
        }
        errorMessage={error ?? undefined}
        submitLabel={isEditing ? "Save changes" : "Add location"}
      />
    </QuickAddDialogShell>
  );
}
