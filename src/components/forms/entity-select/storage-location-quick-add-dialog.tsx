/**
 * Storage Location Quick Add Dialog
 * Create and edit storage bins from an EntitySelect dropdown.
 * Embeds the full StorageLocationForm inside QuickAddDialogShell.
 */
"use client";

import { useState } from "react";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { useUpdateStorageLocation } from "@/hooks/use-storage-locations";
import { useToast } from "@/components/ui/toast";
import { SideSheetActionsContext } from "@/components/ui/entity-side-sheet/side-sheet-context";
import { DetailSpine } from "@/components/ui/detail-panel";
import { storageLocationSheetSections } from "@/components/storage-locations/storage-location-read-sections";
import { toSaveErrorMessage } from "@/lib/stale-version";
import { createStorageLocationFn } from "@/fn/quick-add";
import { StorageLocationForm } from "@/components/storage-locations/storage-location-form";
import type { StorageLocationFormData } from "@/schemas/storage-locations";
import { useQuickAddSubmit } from "@/hooks/use-quick-add-submit";
import { QuickAddDialogShell } from "./quick-add-dialog-shell";
import type { EntityOption } from "./types";
import type { StorageLocationType } from "@/schemas/storage-locations";
import type { FeedstockTypeUsage } from "@/schemas/feedstock-types";

interface StorageLocationQuickAddDialogProps {
  /** Freshly loaded record for edit mode; archived records render read-only. */
  storageLocation?: StorageLocationWithFacility;
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
  storageLocation,
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
        stockMode: data.stockMode,
        drawOrder: data.drawOrder,
      }),
    onSuccess,
    onClose,
  });

  const update = useUpdateStorageLocation();
  const toast = useToast();
  const [editError, setEditError] = useState<string>();
  const archived = storageLocation?.archivedAt != null;
  const handleUpdate = async (data: StorageLocationFormData) => {
    if (!storageLocation || archived) return;
    setEditError(undefined);
    try {
      await update.mutateAsync({
        ...data,
        storageLocationId: storageLocation.id,
        expectedVersion: storageLocation.version,
      });
      toast.success("Storage bin updated.");
      onClose();
    } catch (error) {
      setEditError(toSaveErrorMessage(error, "Storage bin was not saved. Try again."));
    }
  };

  // Read-only fields retain the bin sheet's labels without its stock actions.
  const readSections = archived && storageLocation
    ? storageLocationSheetSections(storageLocation, () => undefined)
      .map((section) => ({ ...section, content: undefined, explanation: undefined, hint: undefined }))
    : [];
  const title = storageLocation
    ? archived ? storageLocation.name : `Edit ${storageLocation.name}`
    : "New storage bin";

  return (
    // Submit still bubbles through React portals to the owning entry form.
    <div className="contents" onSubmit={(event) => event.stopPropagation()}>
      <SideSheetActionsContext.Provider value={null}>
        <QuickAddDialogShell
          isOpen={isOpen}
          onClose={onClose}
          title={title}
          onOpen={() => setEditError(undefined)}
          testId="storage-location-quick-add-dialog"
        >
          {archived ? (
            <DetailSpine sections={readSections} />
          ) : (
            <StorageLocationForm
              key={storageLocation?.id ?? "create"}
              storageLocation={storageLocation}
              onSubmit={storageLocation ? handleUpdate : handleSubmit}
              onCancel={onClose}
              isSubmitting={isSubmitting || update.isPending}
              errorMessage={storageLocation ? editError : error ?? undefined}
              submitLabel={storageLocation ? "Save changes" : "Create storage bin"}
              defaultType={defaultBinType}
              allowedTypes={allowedTypes}
              defaultFeedstockTypeId={defaultFeedstockTypeId}
              feedstockTypeUsage={feedstockTypeUsage}
              lockFeedstockType={lockFeedstockType ?? Boolean(defaultFeedstockTypeId)}
              defaultFormulationId={defaultFormulationId}
              defaultFacilityId={facilityId}
            />
          )}
        </QuickAddDialogShell>
      </SideSheetActionsContext.Provider>
    </div>
  );
}
