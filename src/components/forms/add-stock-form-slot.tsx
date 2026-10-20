"use client";

import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/loading-skeleton";

/**
 * Holds a create form back while the bin an "adding stock" link names is read
 * (`useAddStockBin().settling`), so the form mounts once with that bin chosen
 * and is never remounted under what the operator typed.
 */
export function AddStockFormSlot({ settling, children }: { settling: boolean; children: ReactNode }) {
  if (!settling) return children;
  return (
    <div role="status" aria-label="Loading the bin">
      <Skeleton className="h-160 w-full" />
    </div>
  );
}
