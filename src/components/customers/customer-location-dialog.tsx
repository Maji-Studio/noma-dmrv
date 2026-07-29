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
import type { CustomerLocationFormData } from "@/schemas/customers";
import {
  CustomerLocationForm,
  type EditableCustomerLocation,
} from "./customer-location-form";

// ============================================
// Types
// ============================================

interface CustomerLocationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
  location?: EditableCustomerLocation;
}

// ============================================
// Component
// ============================================

export function CustomerLocationDialog({
  isOpen,
  onClose,
  customerId,
  location,
}: CustomerLocationDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const createLocation = useCreateCustomerLocation();
  const updateLocation = useUpdateCustomerLocation();
  const isEditing = location !== undefined;

  // Modal unmounts its children while closed, so the embedded form resets on
  // every open. Only the dialog-level server error needs clearing.
  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleSubmit = async (data: CustomerLocationFormData) => {
    setError(null);
    try {
      const locationData = {
        name: data.name,
        country: data.country,
        stateRegion: data.stateRegion || null,
        city: data.city || null,
        address: data.address,
        gpsLatitude: data.gpsLatitude,
        gpsLongitude: data.gpsLongitude,
        distanceFromFacilityKm: data.distanceFromFacilityKm,
        distanceSource: data.distanceSource,
        defaultSoilTemperatureC: data.defaultSoilTemperatureC,
        isDefault: data.isDefault,
      };

      if (location) {
        await updateLocation.mutateAsync({
          locationId: location.id,
          ...locationData,
        });
      } else {
        await createLocation.mutateAsync({
          customerId,
          ...locationData,
        });
      }
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isEditing
            ? "The location was not saved. Try again."
            : "The location was not created. Check the form and try again."
      );
    }
  };

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? "Edit Location" : "Add Location"}
      width="lg"
      testId={
        isEditing ? "customer-location-edit-dialog" : "location-quick-add-dialog"
      }
    >
      <CustomerLocationForm
        location={location}
        onSubmit={handleSubmit}
        onCancel={handleClose}
        isSubmitting={
          isEditing ? updateLocation.isPending : createLocation.isPending
        }
        errorMessage={error ?? undefined}
        submitLabel={isEditing ? "Save Changes" : "Add Location"}
      />
    </QuickAddDialogShell>
  );
}
