/**
 * Driver Quick Add Dialog
 * Inline dialog for quickly adding new drivers from EntitySelect dropdown.
 * Embeds the full DriverForm inside QuickAddDialogShell.
 */
"use client";

import { createDriverFn } from "@/fn/quick-add";
import { DriverForm } from "@/components/drivers/driver-form";
import type { DriverFormData } from "@/schemas/drivers";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";

interface DriverQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
}

export function DriverQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
}: DriverQuickAddDialogProps) {
  const { error, isSubmitting, handleSubmit } = useQuickAddSubmit<DriverFormData>({
    entityType: "driver",
    serverFn: (data) =>
      createDriverFn({
        name: data.name.trim(),
        licenseNumber: data.licenseNumber?.trim() || null,
        contactPhone: data.contactPhone?.trim() || null,
      }),
    onSuccess,
    onClose,
  });

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Add New Driver"
      width="sm"
      testId="driver-quick-add-dialog"
    >
      <DriverForm
        onSubmit={handleSubmit}
        onCancel={onClose}
        isSubmitting={isSubmitting}
        errorMessage={error ?? undefined}
        submitLabel="Create Driver"
      />
    </QuickAddDialogShell>
  );
}
