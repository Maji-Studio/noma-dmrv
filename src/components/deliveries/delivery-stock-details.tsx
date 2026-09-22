"use client";
import { useFormDetailLevel, CompositionCard, CompositionLedger } from "@/components/forms";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { OutputStockAllocations } from "@/components/storage-locations/output-stock-preview";
import { useOutputStockHistory } from "@/hooks/use-output-stock";
import { formatMassKg } from "@/lib/format-utils";

export function DeliveryStockDetails({ deliveryId, storageLocationId, facilityId, wetMassKg, dryMassKg }: { deliveryId: string; storageLocationId: string | null; facilityId: string; wetMassKg: number | null; dryMassKg: number | null }) {
  const level = useFormDetailLevel();
  const history = useOutputStockHistory(storageLocationId ?? "", !!storageLocationId);
  const entries = history.data?.filter(entry => entry.deliveryId === deliveryId && entry.kind !== "reversal");
  const reversedIds = new Set(history.data?.filter(entry => entry.kind === "reversal").map(entry => entry.correctsMovementId));
  const current = entries?.filter(entry => !reversedIds.has(entry.id)).at(-1);
  return <>
    {history.isLoading && level === "detailed" && <p role="status">Loading batch breakdown...</p>}
    {history.error && <p role="alert">{history.error.message}</p>}
    <div hidden={level === "simple"}>
      <CompositionCard title="Delivery stock" details={<>
        {current && <OutputStockAllocations allocations={current.allocations} />}
        <p className="body-caption">To change stock measurements, open stock history and correct the original delivery entry.</p>
        {storageLocationId && <OutputStockHistory compact triggerLabel="Stock history" storageLocationId={storageLocationId} facilityId={facilityId} />}
      </>}>
        <p className="body-small">{formatMassKg(current ? current.wetMassKg : wetMassKg)} recorded wet</p>
        <CompositionLedger label="Delivered batches" totalLabel="Dry biochar" total={current ? current.dryMassKg : dryMassKg} segments={(current?.allocations ?? []).map(allocation => ({ label: allocation.code, mass: allocation.dryMassKg, category: "dry-batch" }))} />
      </CompositionCard>
    </div>
  </>;
}
