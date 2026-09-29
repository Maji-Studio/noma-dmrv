"use client";

import { CompositionCard, DerivedHeadline } from "@/components/forms";
import { formatCompositionMass } from "@/components/forms/composition-ledger";
import { SegmentBar, SegmentKey } from "@/components/ui/segment-bar";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatMassKg } from "@/lib/format-utils";
import type { OutputStockAllocationView } from "@/types/output-stock";
import type { ReactNode } from "react";
import { StockRows } from "./stock-figures";
import { batchSegments, formatWetEstimate } from "./stock-preview-shared";

/** The one definition the availability block cannot show as a number. */
const AVAILABILITY_HINT =
  "Dry biochar is the tracked quantity. Wet availability depends on measured departure moisture. Stock stays available to every order until a delivery records the bin it left.";

/**
 * Which batches a draw touched, and which run produced each one.
 *
 * Nothing renders when the draw touched no batch: a heading over the words "no
 * dry biochar removed" is a second copy of a number the block already shows.
 */
export function OutputStockAllocations({ allocations }: { allocations: OutputStockAllocationView[] }) {
  if (allocations.length === 0) return null;
  return (
    <div className="space-y-8" aria-label="Batch breakdown">
      <h4 className="body-small font-medium">Batch breakdown</h4>
      <dl className="space-y-8">
        {allocations.map((allocation) => (
          <div key={allocation.layerId} className="space-y-2">
            <div className="flex items-baseline justify-between gap-12">
              <dt className="body-caption">{allocation.code}</dt>
              <dd className="body-small tabular-nums text-right">{formatMassKg(allocation.dryMassKg)}</dd>
            </div>
            {allocation.runs.map((run) => (
              <div key={run.productionRunId} className="flex items-baseline justify-between gap-12 pl-12">
                <dt className="body-caption text-[var(--color-text-secondary)]">Source run {run.code}</dt>
                <dd className="body-caption tabular-nums text-right text-[var(--color-text-secondary)]">{formatMassKg(run.dryMassKg)}</dd>
              </div>
            ))}
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Key figures under a wet headline: batches are tracked dry, so they say so. */
function formatDryKeyMass(kg: number | null): string {
  return `${formatCompositionMass(kg)} dry`;
}

/**
 * A bin's current stock, for surfaces that pick a bin rather than move material.
 *
 * Same shape as the movement blocks: caption, one headline figure, the batches
 * the bin holds as one bar and its key, then the tracked dry stock as a row in
 * Detailed, then one action row. There is no before and after because nothing
 * is moving yet.
 *
 * Operators plan loads in wet mass, so the headline is the wet estimate when a
 * moisture gives one (`wetEstimate`, with the basis it was computed at as its
 * caption). Without it the dry stock is the only honest figure and takes the
 * headline itself: a wet number at a moisture nobody measured would be made up.
 */
export function OutputStockAvailability({ binName, dryKg, wetEstimate = null, allocations = [], actions }: {
  binName: string;
  dryKg: number | null;
  /** Wet stock at a known moisture, and a caption naming that moisture. */
  wetEstimate?: { kg: number; basis: string } | null;
  allocations?: OutputStockAllocationView[];
  actions?: ReactNode;
}) {
  // A spent batch holds nothing to order against, so it stays off the block.
  const held = allocations.filter(allocation => allocation.dryMassKg > 0);
  const segments = batchSegments(held);
  const dry = dryKg == null ? MISSING_VALUE.notAvailable : `${formatMassKg(dryKg)} dry biochar`;
  return (
    <CompositionCard
      title={binName}
      hint={AVAILABILITY_HINT}
      actions={actions}
      calculation={held.length > 0 ? <OutputStockAllocations allocations={held} /> : undefined}
      headline={wetEstimate
        ? <DerivedHeadline label="Available wet stock, estimate" value={`≈ ${formatWetEstimate(wetEstimate.kg)} kg wet`} sub={wetEstimate.basis} />
        : <DerivedHeadline label="Available dry stock" value={dry} />}
      detail={wetEstimate ? <StockRows label="Tracked stock" rows={[{ label: "Available dry stock", value: dry }]} /> : undefined}
    >
      {segments.length > 0 && <div className="flex flex-col gap-6">
        <SegmentBar label={`Batches in ${binName}`} segments={segments} />
        <SegmentKey segments={segments} format={formatDryKeyMass} />
      </div>}
    </CompositionCard>
  );
}
