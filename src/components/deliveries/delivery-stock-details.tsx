"use client";
import { useFormDetailLevel, CompositionCard, CompositionLedger } from "@/components/forms";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { OutputStockAllocations } from "@/components/storage-locations/output-stock-preview";
import { formatWetAtMoisture, StockNotice, StockRows } from "@/components/storage-locations/stock-figures";
import { useOutputStockHistory } from "@/hooks/use-output-stock";

/** The definition the ledger cannot show as a figure. */
const DELIVERY_STOCK_HINT =
  "These are the batches this delivery drew, by dry biochar. To change the measured masses, correct the original delivery entry in stock history.";

export function DeliveryStockDetails({ deliveryId, storageLocationId, facilityId, wetMassKg, dryMassKg }: { deliveryId: string; storageLocationId: string | null; facilityId: string; wetMassKg: number | null; dryMassKg: number | null }) {
  const level = useFormDetailLevel();
  const history = useOutputStockHistory(storageLocationId ?? "", !!storageLocationId);
  const entries = history.data?.filter(entry => entry.deliveryId === deliveryId && entry.kind !== "reversal");
  const reversedIds = new Set(history.data?.filter(entry => entry.kind === "reversal").map(entry => entry.correctsMovementId));
  const current = entries?.filter(entry => !reversedIds.has(entry.id)).at(-1);
  const allocations = current?.allocations ?? [];
  const sourced = allocations.some(allocation => allocation.runs.length > 0);
  return <>
    {history.isLoading && level === "detailed" && <p role="status" className="body-caption text-[var(--color-text-secondary)]">Loading the batch breakdown</p>}
    {history.error && <StockNotice tone="error" role="alert">{history.error.message}</StockNotice>}
    <div hidden={level === "simple"}>
      {/* Figures, not prose. The wet row is the saved measurement as corrected,
          which is the one number the delivery's own field can no longer show. */}
      <CompositionCard title="Delivery stock" hint={DELIVERY_STOCK_HINT} calculation={sourced ? <OutputStockAllocations allocations={allocations} /> : undefined}>
        <StockRows label="Delivery stock figures" rows={[{ label: "Wet mass", value: formatWetAtMoisture(current ? current.wetMassKg : wetMassKg, current?.moisturePercent ?? null) }]} />
        <CompositionLedger hideZero label="Delivered batches" totalLabel="Dry biochar" total={current ? current.dryMassKg : dryMassKg} segments={allocations.map(allocation => ({ label: allocation.code, mass: allocation.dryMassKg, category: "dry-batch" }))} />
        {storageLocationId && <OutputStockHistory compact triggerLabel="Stock history" storageLocationId={storageLocationId} facilityId={facilityId} />}
      </CompositionCard>
    </div>
  </>;
}
