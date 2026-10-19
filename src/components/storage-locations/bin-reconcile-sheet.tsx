"use client";

import { FormDetailProvider, FormDetailControl } from "@/components/forms/form-detail-context";
import { LOST_MASS_LABEL } from "@/lib/output-stock/labels";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { binCurrentMassKg } from "./bin-display";
import { OutputStockForm } from "./output-stock-form";
import { FeedstockLossForm } from "./feedstock-loss-form";

interface BinReconcileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageLocation: StorageLocationWithFacility | null;
  /** Called after a movement is recorded (parent closes + toasts already fired). */
  onRecorded?: () => void;
}

export function BinReconcileSheet({
  open,
  onOpenChange,
  storageLocation,
  onRecorded,
}: BinReconcileSheetProps) {
  const close = () => onOpenChange(false);
  const handleRecorded = () => {
    onRecorded?.();
    close();
  };

  return (
    <FormDetailProvider scope={`${open}:${storageLocation?.id}`} enabled={!!storageLocation && storageLocation.type !== "feedstock_bin"}>
    <SlideOverPanel.Root open={open} onOpenChange={onOpenChange}>
      <SlideOverPanel.Content size="default">
        <SlideOverPanel.Header showClose actions={<FormDetailControl />}>
          <div className="flex flex-col gap-4 min-w-0">
            <SlideOverPanel.Title>
              {LOST_MASS_LABEL}
            </SlideOverPanel.Title>
            {storageLocation && (
              <SlideOverPanel.Description className="truncate">
                {storageLocation.name}
              </SlideOverPanel.Description>
            )}
          </div>
        </SlideOverPanel.Header>

        {/* Single child: fillHeight stretches only the direct child, so the
            context and form live inside one flex column here. */}
        <SlideOverPanel.Body noPaddingBottom fillHeight>
          {storageLocation && (
            <div className="flex flex-1 flex-col gap-20">
              {storageLocation.type === "feedstock_bin" ? <>
              {/* Keyed so switching bins resets the form's state. */}
              <FeedstockLossForm
                key={`loss-${storageLocation.id}`}
                storageLocationId={storageLocation.id}
                facilityId={storageLocation.facilityId}
                availableKg={binCurrentMassKg(storageLocation)}
                moisturePercent={storageLocation.feedstockInventory.estimatedMoisturePercent}
                onCancel={close}
                onRecorded={handleRecorded}
              />
              </> : <>
                <OutputStockForm key={storageLocation.id} storageLocationId={storageLocation.id} facilityId={storageLocation.facilityId} onCancel={close} onRecorded={handleRecorded} />
              </> }
            </div>
          )}
        </SlideOverPanel.Body>
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
    </FormDetailProvider>
  );
}
