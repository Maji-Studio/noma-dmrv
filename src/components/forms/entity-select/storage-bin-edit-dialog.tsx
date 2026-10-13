"use client";

import type { useStorageBinEditDialog } from "@/hooks/use-storage-bin-edit-dialog";
import { StorageLocationQuickAddDialog } from "./storage-location-quick-add-dialog";

export function StorageBinEditDialog({ bin, close }: Pick<ReturnType<typeof useStorageBinEditDialog>, "bin" | "close">) {
  if (!bin) return null;
  return (
    <StorageLocationQuickAddDialog
      isOpen
      storageLocation={bin}
      facilityId={bin.facilityId}
      onClose={close}
      onSuccess={() => undefined}
    />
  );
}
