"use client";

import { useState } from "react";
import { addStockBinId, resolveAddStockBin, type AddStockLane } from "@/lib/add-stock-intent";
import { useStorageLocation } from "./use-storage-locations";

/**
 * The bin a list's create form opens with after a bin's "adding stock" link.
 * `request` takes the link's bin parameter; the bin is read through the
 * org-scoped lookup only while the create form is open, and kept only when it
 * is the kind of bin this form fills in the active facility.
 */
export function useAddStockBin(lane: AddStockLane, facilityId: string | null | undefined, creating: boolean) {
  const [binId, setBinId] = useState<string | null>(null);
  const read = useStorageLocation(creating ? binId : null);
  return {
    bin: creating && binId !== null ? resolveAddStockBin(read.data, lane, facilityId) : null,
    request: (value: string | null) => setBinId(addStockBinId(value)),
    clear: () => setBinId(null),
  };
}
