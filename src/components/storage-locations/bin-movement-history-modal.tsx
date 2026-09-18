"use client";
import { Button } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { useState } from "react";
import { BinMovementHistory } from "./bin-movement-history";

export function BinMovementHistoryModal({ storageLocationId }: { storageLocationId: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="default" onClick={() => setOpen(true)}>More info</Button>
    <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Reconciliation history">
      <BinMovementHistory storageLocationId={storageLocationId} />
    </Modal>
  </>;
}
