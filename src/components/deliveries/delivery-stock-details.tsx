/**
 * Delivery stock — which batches this delivery drew, by dry biochar.
 *
 * The bar is the answer: one block per batch drawn, with a key line naming each
 * batch and its dry mass. Simple stops there, because the bar and the key are
 * what the saved draw means. Detailed adds the corrected wet measurement and
 * the ledger with each batch's share of the total.
 *
 * The action row carries `Show calculation` for the production runs behind each
 * batch and the stock history dialog. The calculation deliberately holds runs
 * only: the ledger directly above it already totals every batch, and two
 * breakdowns of the same draw read as two competing answers. Stock history
 * stays mounted at both detail levels so a half-written correction survives a
 * toggle.
 */
"use client";
import { useFormDetailLevel, CompositionCard, CompositionLedger } from "@/components/forms";
import { SourceRunGroups, type SourceRunGroup } from "@/components/forms/source-run-groups";
import { SegmentBar, SegmentKey, batchAccentFill } from "@/components/ui/segment-bar";
import type { MassSegment } from "@/components/forms/composition-ledger";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { formatWetAtMoisture, StockNotice, StockRows } from "@/components/storage-locations/stock-figures";
import { useOutputStockHistory } from "@/hooks/use-output-stock";

/** The definition the ledger cannot show as a figure. */
const DELIVERY_STOCK_HINT =
  "These are the batches this delivery drew, by dry biochar. To change the measured masses, correct the original delivery entry in stock history.";
/** Names the whole in the bar's accessible name and in the ledger's total row. */
const TOTAL_LABEL = "Dry biochar";

export function DeliveryStockDetails({ deliveryId, storageLocationId, facilityId, wetMassKg, dryMassKg }: { deliveryId: string; storageLocationId: string | null; facilityId: string; wetMassKg: number | null; dryMassKg: number | null }) {
  const level = useFormDetailLevel();
  const detailed = level === "detailed";
  const history = useOutputStockHistory(storageLocationId ?? "", !!storageLocationId);
  const entries = history.data?.filter(entry => entry.deliveryId === deliveryId && entry.kind !== "reversal");
  const reversedIds = new Set(history.data?.filter(entry => entry.kind === "reversal").map(entry => entry.correctsMovementId));
  const current = entries?.filter(entry => !reversedIds.has(entry.id)).at(-1);
  const allocations = current?.allocations ?? [];
  const segments: MassSegment[] = allocations.map((allocation, index) => ({
    label: allocation.code,
    mass: allocation.dryMassKg,
    category: "dry-batch",
    fill: batchAccentFill(index),
  }));
  const drawn = segments.filter(segment => (segment.mass ?? 0) > 0);
  const groups: SourceRunGroup[] = allocations
    .filter(allocation => allocation.runs.length > 0)
    .map(allocation => ({
      label: allocation.code,
      runs: allocation.runs.map(run => ({ id: run.productionRunId, code: run.code, dryMassKg: run.dryMassKg })),
    }));
  return <>
    {history.isLoading && detailed && <p role="status" className="body-caption text-[var(--color-text-secondary)]">Loading the batch breakdown</p>}
    {history.error && <StockNotice tone="error" role="alert">{history.error.message}</StockNotice>}
    <CompositionCard
      title="Delivery stock"
      hint={DELIVERY_STOCK_HINT}
      calculation={detailed && groups.length > 0 ? <SourceRunGroups label="Source production runs per delivered batch" groups={groups} /> : undefined}
      actions={storageLocationId ? <OutputStockHistory compact triggerLabel="Stock history" storageLocationId={storageLocationId} facilityId={facilityId} /> : undefined}
    >
      {drawn.length > 0 && <div className="space-y-8">
        <SegmentBar label={TOTAL_LABEL} segments={drawn} />
        <SegmentKey segments={drawn} />
      </div>}
      {/* Figures, not prose. The wet row is the saved measurement as corrected,
          which is the one number the delivery's own field can no longer show. */}
      <div hidden={!detailed} className="space-y-12">
        <StockRows label="Delivery stock figures" rows={[{ label: "Wet mass", value: formatWetAtMoisture(current ? current.wetMassKg : wetMassKg, current?.moisturePercent ?? null) }]} />
        <CompositionLedger hideZero label="Delivered batches" totalLabel={TOTAL_LABEL} total={current ? current.dryMassKg : dryMassKg} segments={segments} />
      </div>
    </CompositionCard>
  </>;
}
