"use client";
import { Button } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import { BinMovementHistory } from "./bin-movement-history";

const COMPACT_ICON_PX = 18;

/**
 * A feedstock bin's reconciliation history behind one button.
 *
 * `compact` is the quiet trigger for a derived block's action row, matching
 * `OutputStockHistory compact`: an icon and a caption-size label instead of a
 * bordered button, so it sits beside "Show calculation" without outweighing it.
 */
export function BinMovementHistoryModal({ storageLocationId, triggerLabel = "More info", compact = false, "aria-label": ariaLabel }: {
  storageLocationId: string;
  triggerLabel?: string;
  compact?: boolean;
  /** Names the bin when several history triggers share one surface. */
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <Button
      type="button"
      variant={compact ? "noOutline" : "default"}
      className={compact ? "min-h-44 gap-8 px-8 normal-case" : undefined}
      aria-label={ariaLabel}
      onClick={() => setOpen(true)}
    >
      {compact && <ClockCounterClockwiseIcon size={COMPACT_ICON_PX} aria-hidden="true" />}
      <span className={compact ? "body-caption normal-case" : undefined}>{triggerLabel}</span>
    </Button>
    <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Reconciliation history">
      <BinMovementHistory storageLocationId={storageLocationId} />
    </Modal>
  </>;
}
