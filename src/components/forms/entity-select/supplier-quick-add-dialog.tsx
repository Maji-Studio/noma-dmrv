/**
 * Supplier Quick Add Dialog
 * Inline dialog for creating a supplier from an EntitySelect dropdown.
 * Embeds the canonical SupplierForm so the required initial source-location
 * workflow stays identical to the Suppliers page.
 */
"use client";

import {
  SupplierForm,
  type PendingSupplierLocation,
} from "@/components/suppliers/supplier-form";
import { createSupplierWithLocationsFn } from "@/fn/suppliers";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import type { SupplierFormData } from "@/schemas/suppliers";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";

interface SupplierQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
}

interface SupplierQuickAddFormData {
  supplier: SupplierFormData;
  locations: PendingSupplierLocation[];
}

export function SupplierQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
}: SupplierQuickAddDialogProps) {
  const { error, isSubmitting, handleSubmit } =
    useQuickAddSubmit<SupplierQuickAddFormData>({
      entityType: "supplier",
      serverFn: createSupplierWithLocationsFn,
      onSuccess,
      onClose,
    });

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="New supplier"
      width="lg"
      testId="supplier-quick-add-dialog"
    >
      <SupplierForm
        onSubmit={(supplier, locations) =>
          handleSubmit({ supplier, locations: locations ?? [] })
        }
        onCancel={onClose}
        isSubmitting={isSubmitting}
        errorMessage={error ?? undefined}
        submitLabel="Create supplier"
      />
    </QuickAddDialogShell>
  );
}
