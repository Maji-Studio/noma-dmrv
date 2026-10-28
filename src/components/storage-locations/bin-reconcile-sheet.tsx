"use client";

import { LOST_MASS_LABEL } from "@/lib/output-stock/labels";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { SHEET_FORM_FILL } from "@/components/ui/entity-side-sheet";
import { cn } from "@/lib/utils";
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
    <SlideOverPanel.Root open={open} onOpenChange={onOpenChange}>
      <SlideOverPanel.Content size="default">
        <SlideOverPanel.Header showClose>
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

        {/* Single child: fillHeight only makes the body a flex column; the
            wrapper fills it and every element down to the form's sticky
            footer fills too (SHEET_FORM_FILL), so the footer pins. */}
        <SlideOverPanel.Body noPaddingBottom fillHeight>
          {storageLocation && (
            <div className={cn(SHEET_FORM_FILL, "gap-20")}>
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
  );
}
