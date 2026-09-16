"use client";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { OutputStockAllocations } from "@/components/storage-locations/output-stock-preview";
import { useOutputStockHistory } from "@/hooks/use-output-stock";
import { formatMassKg } from "@/lib/format-utils";

export function DeliveryStockDetails({ deliveryId, storageLocationId, facilityId, wetMassKg, dryMassKg }: { deliveryId: string; storageLocationId: string | null; facilityId: string; wetMassKg: number | null; dryMassKg: number | null }) {
  const history = useOutputStockHistory(storageLocationId ?? "", !!storageLocationId);
  const entries = history.data?.filter(entry => entry.deliveryId === deliveryId && entry.kind !== "reversal");
  const reversedIds = new Set(history.data?.filter(entry => entry.kind === "reversal").map(entry => entry.correctsMovementId));
  const current = entries?.filter(entry => !reversedIds.has(entry.id)).at(-1);
  return <div className="space-y-12">
    <div><p className="body-large">{formatMassKg(wetMassKg)} recorded wet</p><p className="body-caption">{formatMassKg(dryMassKg)} dry biochar</p></div>
    {history.isLoading && <p role="status">Loading batch breakdown...</p>}
    {history.error && <p role="alert">{history.error.message}</p>}
    {current && <OutputStockAllocations allocations={current.allocations} />}
    {storageLocationId && <OutputStockHistory storageLocationId={storageLocationId} facilityId={facilityId} />}
  </div>;
}
