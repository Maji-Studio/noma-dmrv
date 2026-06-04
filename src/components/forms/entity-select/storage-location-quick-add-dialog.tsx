/**
 * Storage Location Quick Add Dialog
 * Inline dialog for quickly adding new storage bins from EntitySelect dropdown.
 * Embeds the full StorageLocationForm inside QuickAddDialogShell.
 */
"use client";

import { createStorageLocationFn } from "@/fn/quick-add";
import { StorageLocationForm } from "@/components/storage-locations/storage-location-form";
import type { StorageLocationFormData } from "@/schemas/storage-locations";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";
import type { StorageLocationType } from "@/schemas/storage-locations";

interface StorageLocationQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
  /** Pre-selected bin type based on feedstock category */
  defaultBinType?: StorageLocationType;
  /** Facility ID (required for creation) */
  facilityId: string;
}

export function StorageLocationQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
  defaultBinType,
  facilityId,
}: StorageLocationQuickAddDialogProps) {
  const { error, isSubmitting, handleSubmit } = useQuickAddSubmit<StorageLocationFormData>({
    entityType: "storageLocation",
    serverFn: (data) =>
      createStorageLocationFn({
        name: data.name,
        type: data.type,
        facilityId: data.facilityId || facilityId,
        capacityKg: data.capacityKg ?? null,
        formulationId: data.formulationId ?? null,
      }),
    onSuccess,
    onClose,
  });

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Add New Storage Bin"
      error={error}
      testId="storage-location-quick-add-dialog"
    >
      <StorageLocationForm
        onSubmit={handleSubmit}
        onCancel={onClose}
        isSubmitting={isSubmitting}
        submitLabel="Create Bin"
        defaultType={defaultBinType}
      />
    </QuickAddDialogShell>
  );
}
