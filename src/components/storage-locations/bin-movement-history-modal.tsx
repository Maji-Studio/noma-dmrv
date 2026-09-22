"use client";
import { Button } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { useState } from "react";
import { BinMovementHistory } from "./bin-movement-history";

export function BinMovementHistoryModal({ storageLocationId, triggerLabel = "More info", quietTrigger = false }: { storageLocationId: string; triggerLabel?: string; quietTrigger?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant={quietTrigger ? "noOutline" : "default"} onClick={() => setOpen(true)}>{quietTrigger ? <span className="body-caption normal-case">{triggerLabel}</span> : triggerLabel}</Button>
    <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Reconciliation history">
      <BinMovementHistory storageLocationId={storageLocationId} />
    </Modal>
  </>;
}
