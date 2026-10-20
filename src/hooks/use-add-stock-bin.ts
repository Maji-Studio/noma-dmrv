"use client";

import { useState } from "react";
import { addStockBinId, resolveAddStockBin, type AddStockLane } from "@/lib/add-stock-intent";
import { useStorageLocation } from "./use-storage-locations";

/**
 * The bin a list's create form opens with after a bin's "adding stock" link.
 * `request` takes the link's bin parameter; the bin is read through the
 * org-scoped lookup only while the create form is open, and kept only when it
 * is the kind of bin this form fills in the active facility. `settling` is
 * true until that first read answers: the list holds the form back until then,
 * so the form mounts once with its bin and nothing typed is ever thrown away.
 * A later refetch keeps `settling` false (the read already has data).
 */
export function useAddStockBin(lane: AddStockLane, facilityId: string | null | undefined, creating: boolean) {
  const [binId, setBinId] = useState<string | null>(null);
  const requested = creating && binId !== null;
  const read = useStorageLocation(requested ? binId : null);
  return {
    bin: requested ? resolveAddStockBin(read.data, lane, facilityId) : null,
    settling: requested && read.isPending,
    request: (value: string | null) => setBinId(addStockBinId(value)),
    clear: () => setBinId(null),
  };
}
