"use client";
import { useOutputStockPreview } from "@/hooks/use-output-stock";
import { formatLocalDate } from "@/lib/date-utils";
import { formatMassKg } from "@/lib/format-utils";

export function OutputBinBalance({ storageLocationId, facilityId }: { storageLocationId: string; facilityId: string }) {
  const preview = useOutputStockPreview({ storageLocationId, facilityId, physicalDate: formatLocalDate(new Date()), kind: "count", wetMassKg: 0 });
  return <div className="space-y-4">
    {preview.isLoading && <p role="status">Loading dry stock...</p>}
    {preview.error && <p role="alert">{preview.error.message}</p>}
    {preview.data && <p className="body-medium">{formatMassKg(preview.data.beforeDryKg)} dry biochar available</p>}
    <p className="body-caption">Wet stock depends on current moisture. A delivery measurement does not replace the pile measurement.</p>
  </div>;
}
