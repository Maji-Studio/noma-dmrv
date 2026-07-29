/**
 * Customer Location Quick Add Dialog
 * Dialog for quickly adding new customer locations from the customer edit form.
 * Embeds the full CustomerLocationForm (RHF + Zod) inside QuickAddDialogShell
 * so validation stays centralized in `customerLocationFormSchema`.
 */
"use client";

import { useState } from "react";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import { useCreateCustomerLocation } from "@/hooks/use-customers";
import type { CustomerLocationFormData } from "@/schemas/customers";
import { CustomerLocationForm } from "./customer-location-form";

// ============================================
// Types
// ============================================

interface CustomerLocationQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string;
}

// ============================================
// Component
// ============================================

export function CustomerLocationQuickAddDialog({
  isOpen,
  onClose,
  customerId,
}: CustomerLocationQuickAddDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const createLocation = useCreateCustomerLocation();

  // Modal unmounts its children while closed, so the embedded form resets
  // itself on every open — only the dialog-level server error needs clearing.
  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleSubmit = async (data: CustomerLocationFormData) => {
    setError(null);
    try {
      await createLocation.mutateAsync({
        customerId,
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
      });
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "The location was not created. Check the form and try again."
      );
    }
  };

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Location"
      width="lg"
      testId="location-quick-add-dialog"
    >
      <CustomerLocationForm
        onSubmit={handleSubmit}
        onCancel={handleClose}
        isSubmitting={createLocation.isPending}
        errorMessage={error ?? undefined}
        submitLabel="Add Location"
      />
    </QuickAddDialogShell>
  );
}
