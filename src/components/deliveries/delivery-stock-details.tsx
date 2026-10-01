/**
 * Delivery stock — which batches this delivery drew, by dry biochar.
 *
 * The saved wet measurement, as corrected, leads; then the bar with one block
 * per batch drawn and a key line naming each batch and its dry mass. Both
 * levels show them. Detailed adds the ledger with each batch's share of the
 * total.
 *
 * The action row carries `Show calculation` (Detailed) for the production runs
 * behind each batch and the stock history dialog (both levels). The calculation
 * deliberately holds runs only: the ledger above it already totals every batch,
 * and two breakdowns of the same draw read as two competing answers. The card
 * draws its rule only above the calculation control, so Simple has none.
 */
"use client";
import { CompositionCard, CompositionLedger } from "@/components/forms";
import { formatWetAtMoisture, StockRows } from "@/components/storage-locations/stock-figures";
import { SourceRunGroups, type SourceRunGroup } from "@/components/forms/source-run-groups";
import { SegmentBar, SegmentKey, batchAccentFill } from "@/components/ui/segment-bar";
import type { MassSegment } from "@/components/forms/composition-ledger";
import { formatDryKeyMass } from "@/components/storage-locations/stock-preview-shared";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { useOutputStockHistory } from "@/hooks/use-output-stock";
import { Notice } from "@/components/ui/notice";

/** The definition the ledger cannot show as a figure. */
const DELIVERY_STOCK_HINT =
  "These are the batches this delivery drew, by dry biochar. To change the measured masses, correct the original delivery entry in stock history.";
/** Names the whole in the bar's accessible name and in the ledger's total row. */
const TOTAL_LABEL = "Dry biochar";

export function DeliveryStockDetails({ deliveryId, storageLocationId, facilityId, wetMassKg, dryMassKg }: { deliveryId: string; storageLocationId: string | null; facilityId: string; wetMassKg: number | null; dryMassKg: number | null }) {
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
  const wetKg = current ? current.wetMassKg : wetMassKg;
  const moisturePercent = current?.moisturePercent ?? null;
  const drawn = segments.filter(segment => (segment.mass ?? 0) > 0);
  const groups: SourceRunGroup[] = allocations
    .filter(allocation => allocation.runs.length > 0)
    .map(allocation => ({
      label: allocation.code,
      runs: allocation.runs.map(run => ({ id: run.productionRunId, code: run.code, dryMassKg: run.dryMassKg })),
    }));
  return <>
    {history.error && <Notice tone="error">{history.error.message}</Notice>}
    <CompositionCard
      ruleOnlyWithCalculation
      title="Delivery stock"
      hint={DELIVERY_STOCK_HINT}
      actions={storageLocationId ? <OutputStockHistory compact triggerLabel="Stock history" storageLocationId={storageLocationId} facilityId={facilityId} /> : undefined}
      calculation={groups.length > 0 ? <SourceRunGroups label="Source production runs per delivered batch" groups={groups} /> : undefined}
      detail={<CompositionLedger hideZero label="Delivered batches" totalLabel={TOTAL_LABEL} total={current ? current.dryMassKg : dryMassKg} segments={segments} />}
    >
      {/* The saved wet measurement as corrected leads: it is the one number the
          delivery's own field can no longer show. Then the batches and the way
          into their history, so the block reads as one figure, one picture and
          one link. */}
      <StockRows label="Delivery stock figures" rows={[{ label: "Wet mass", value: formatWetAtMoisture(wetKg, moisturePercent) }]} />
      {history.isLoading && <p role="status" className="body-caption text-[var(--color-text-secondary)]">Loading the batch breakdown</p>}
      {drawn.length > 0 && <div className="space-y-8">
        <SegmentBar label={TOTAL_LABEL} segments={drawn} />
        <SegmentKey segments={drawn} format={formatDryKeyMass} />
      </div>}
    </CompositionCard>
  </>;
}
