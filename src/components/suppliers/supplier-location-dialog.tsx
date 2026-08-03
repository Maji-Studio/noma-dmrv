/**
 * Supplier location dialog for creating and editing persisted locations.
 * Embeds the full SupplierLocationForm (RHF + Zod) inside QuickAddDialogShell
 * so validation stays centralized in `supplierLocationFormSchema`.
 */
"use client";

import { useState } from "react";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import {
  useCreateSupplierLocation,
  useUpdateSupplierLocation,
} from "@/hooks/use-suppliers";
import type { SupplierLocation } from "@/db/schema/parties";
import type { SupplierLocationFormData } from "@/schemas/suppliers";
import { SupplierLocationForm } from "./supplier-location-form";

const SUPPLIER_LOCATION_DIALOG_ID_PREFIX = "supplier-location-dialog";

// ============================================
// Types
// ============================================

interface SupplierLocationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  supplierId: string;
  location?: SupplierLocation;
}

// ============================================
// Component
// ============================================

export function SupplierLocationDialog({
  isOpen,
  onClose,
  supplierId,
  location,
}: SupplierLocationDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const createLocation = useCreateSupplierLocation();
  const updateLocation = useUpdateSupplierLocation(supplierId);
  const isEditing = location !== undefined;

  // Modal unmounts its children while closed, so the embedded form resets on
  // every open. Only the dialog-level server error needs clearing.
  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleSubmit = async (data: SupplierLocationFormData) => {
    setError(null);
    try {
      if (location) {
        await updateLocation.mutateAsync({
          locationId: location.id,
          ...data,
        });
      } else {
        await createLocation.mutateAsync({ supplierId, ...data });
      }
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isEditing
            ? "Location was not saved. Try again."
            : "Location was not created. Check the form."
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
        isEditing
          ? "supplier-location-edit-dialog"
          : "supplier-location-quick-add-dialog"
      }
    >
      <SupplierLocationForm
        idPrefix={SUPPLIER_LOCATION_DIALOG_ID_PREFIX}
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
