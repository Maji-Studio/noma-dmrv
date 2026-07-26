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
import type { FeedstockTypeUsage } from "@/schemas/feedstock-types";

interface StorageLocationQuickAddDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (entity: EntityOption) => void;
  /** Pre-selected bin type based on feedstock category */
  defaultBinType?: StorageLocationType;
  /** Restricts the type picker to these bin types (e.g. feedstock + ingredient) */
  allowedTypes?: readonly StorageLocationType[];
  /** Pre-selects the feedstock type the parent flow is working with */
  defaultFeedstockTypeId?: string;
  /** Narrows selectable/quick-added feedstock types by usage. */
  feedstockTypeUsage?: FeedstockTypeUsage;
  /** Prevents changing a parent-selected feedstock type. */
  lockFeedstockType?: boolean;
  /** Pre-selects the formulation the parent flow is working with */
  defaultFormulationId?: string;
  /** Facility ID (required for creation) */
  facilityId: string;
}

export function StorageLocationQuickAddDialog({
  isOpen,
  onClose,
  onSuccess,
  defaultBinType,
  allowedTypes,
  defaultFeedstockTypeId,
  feedstockTypeUsage,
  lockFeedstockType,
  defaultFormulationId,
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
        feedstockTypeId: data.feedstockTypeId ?? null,
        formulationId: data.formulationId ?? null,
      }),
    onSuccess,
    onClose,
  });

  return (
    <QuickAddDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="New storage bin"
      testId="storage-location-quick-add-dialog"
    >
      <StorageLocationForm
        onSubmit={handleSubmit}
        onCancel={onClose}
        isSubmitting={isSubmitting}
        errorMessage={error ?? undefined}
        submitLabel="Create storage bin"
        defaultType={defaultBinType}
        allowedTypes={allowedTypes}
        defaultFeedstockTypeId={defaultFeedstockTypeId}
        feedstockTypeUsage={feedstockTypeUsage}
        lockFeedstockType={lockFeedstockType ?? Boolean(defaultFeedstockTypeId)}
        defaultFormulationId={defaultFormulationId}
        defaultFacilityId={facilityId}
      />
    </QuickAddDialogShell>
  );
}
