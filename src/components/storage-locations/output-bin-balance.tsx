"use client";
import { useOutputStockBalance } from "@/hooks/use-output-stock";
import { formatMassKg } from "@/lib/format-utils";

export function OutputBinBalance({ storageLocationId, facilityId }: { storageLocationId: string; facilityId: string }) {
  const preview = useOutputStockBalance({ storageLocationId, facilityId });
  return <div className="space-y-4">
    {preview.isLoading && <p role="status">Loading dry stock...</p>}
    {preview.error && <p role="alert">{preview.error.message}</p>}
    {preview.data && <p className="body-medium">{formatMassKg(preview.data.beforeDryKg)} dry biochar available</p>}
    <p className="body-caption">Wet stock depends on current moisture. A delivery measurement does not replace the pile measurement.</p>
  </div>;
}
