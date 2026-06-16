/**
 * Supplier Location Quick Add Dialog
 * Dialog for quickly adding new supplier locations from the supplier edit form.
 * Embeds the full SupplierLocationForm (RHF + Zod) inside QuickAddDialogShell
 * so validation stays centralized in `supplierLocationFormSchema`.
 */
"use client";

import { useState } from "react";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import { useCreateSupplierLocation } from "@/hooks/use-suppliers";
import type { SupplierLocationFormData } from "@/schemas/suppliers";
import { SupplierLocationForm } from "./supplier-location-form";

// ============================================
// Types
// ============================================

interface SupplierLocationQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  supplierId: string;
}

// ============================================
// Component
// ============================================

export function SupplierLocationQuickAddDialog({
  isOpen,
  onClose,
  supplierId,
}: SupplierLocationQuickAddDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const createLocation = useCreateSupplierLocation();

  // Modal unmounts its children while closed, so the embedded form resets
  // itself on every open — only the dialog-level server error needs clearing.
  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleSubmit = async (data: SupplierLocationFormData) => {
    setError(null);
    try {
      await createLocation.mutateAsync({ supplierId, ...data });
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create location"
      );
    }
  };

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Location"
      error={error}
      width="lg"
      testId="supplier-location-quick-add-dialog"
    >
      <SupplierLocationForm
        onSubmit={handleSubmit}
        onCancel={handleClose}
        isSubmitting={createLocation.isPending}
        submitLabel="Add Location"
      />
    </QuickAddDialogShell>
  );
}
