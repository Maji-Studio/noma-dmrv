"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { useLoadStorageLocation } from "./use-storage-locations";

/** Loads a fresh record on each open; one dialog can serve several bin pickers. */
export function useStorageBinEditDialog() {
  const load = useLoadStorageLocation();
  const toast = useToast();
  const request = useRef(0);
  const [bin, setBin] = useState<StorageLocationWithFacility | null>(null);
  const close = () => {
    request.current += 1;
    setBin(null);
  };
  const open = async (id?: string | null) => {
    if (!id) return;
    const current = ++request.current;
    try {
      const loaded = await load(id);
      if (current === request.current) setBin(loaded);
    } catch {
      if (current === request.current) toast.error("The storage bin could not be loaded. Try again.");
    }
  };
  return { bin, open, close };
}
