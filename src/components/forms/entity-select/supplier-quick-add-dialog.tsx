/**
 * Supplier Quick Add Dialog
 * Inline dialog for creating a supplier from an EntitySelect dropdown.
 * Embeds the canonical SupplierForm so the required initial source-location
 * workflow stays identical to the Suppliers page.
 */
"use client";

import { useState } from "react";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { useCreateSupplierWithLocations } from "@/hooks/use-suppliers";
import type { CreateSupplierWithLocationsData } from "@/schemas/suppliers";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";

interface SupplierQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
}

export function SupplierQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
}: SupplierQuickAddDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const createSupplier = useCreateSupplierWithLocations({
    onSuccess: (supplier) => {
      onSuccess({
        id: supplier.id,
        code: supplier.code,
        name: supplier.name,
        subtitle: supplier.location ?? undefined,
      });
      onClose();
    },
    onError: (cause) => {
      setError(cause.message);
    },
  });

  const handleSubmit = async (data: CreateSupplierWithLocationsData) => {
    setError(null);
    try {
      await createSupplier.mutateAsync(data);
    } catch {
      // The mutation callback owns the operator-facing error state.
    }
  };

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      onOpen={() => setError(null)}
      title="New supplier"
      width="lg"
      testId="supplier-quick-add-dialog"
      dismissOnClickOutside={false}
      dismissible={!createSupplier.isPending}
    >
      <SupplierForm
        onSubmit={(supplier, locations) =>
          handleSubmit({ supplier, locations: locations ?? [] })
        }
        onCancel={onClose}
        isSubmitting={createSupplier.isPending}
        errorMessage={error ?? undefined}
        submitLabel="Create supplier"
      />
    </QuickAddDialogShell>
  );
}
