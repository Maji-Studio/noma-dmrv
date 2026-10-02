/**
 * A mix bin's stock as the one pile it is (plan rule 16): the pile's wet
 * estimate and estimated moisture, wet first like a sub-bin card. The batches
 * behind it are an accounting split, not separate heaps, so their shares sit
 * under the pile's own figures as a quieter group.
 */
"use client";

import type { MassSegment } from "@/components/forms/composition-ledger";
import { InfoHint } from "@/components/ui/tooltip";
import { SegmentBar, SegmentKey, batchAccentFill } from "@/components/ui/segment-bar";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { mixPileName } from "@/lib/output-stock/labels";
import type { OutputSubBin } from "@/types/output-stock";
import { formatWetEstimate } from "./stock-preview-shared";

const PILE_WET_HINT = "Wet stock is the wet mass added to the pile less the wet mass taken out. A delivery or loss keeps the pile's moisture; only a count sets it again. Dry biochar limits what can leave.";
const SHARES_LABEL = "Dry biochar by batch";

export function MixPileCard({ binName, wetKg, moisturePercent, dryKg, batches }: {
  binName: string;
  wetKg: number | null;
  moisturePercent: number | null;
  dryKg: number;
  /** The batches the pile holds, oldest first. */
  batches: OutputSubBin[];
}) {
  const segments: MassSegment[] = batches.map((batch, index) => ({
    label: batch.code, mass: batch.dryMassKg, category: "dry-batch", fill: batchAccentFill(index),
  }));
  return (
    <div className="flex flex-col gap-4 bg-[var(--panel-bg)] [border:var(--panel-border)] px-12 py-10">
      <div className="flex items-center justify-between gap-8">
        <span className="body-small font-medium">{mixPileName(binName)}</span>
        <InfoHint label="About the pile's wet estimate">{PILE_WET_HINT}</InfoHint>
      </div>
      <span className="body-small tabular-nums">{wetKg === null ? MISSING_VALUE.notAvailable : `≈ ${formatWetEstimate(wetKg)} kg wet`}</span>
      <span className="body-caption text-[var(--color-text-secondary)] tabular-nums">
        Estimated moisture {moisturePercent === null ? MISSING_VALUE.notAvailable : formatMoisturePercent(moisturePercent)}
      </span>
      <span className="body-caption text-[var(--color-text-secondary)] tabular-nums">{formatMassKg(dryKg)} dry biochar</span>
      {segments.length > 0 && (
        <div className="mt-8 flex flex-col gap-6">
          <span className="body-caption">{SHARES_LABEL}</span>
          {/* One batch is the whole pile; a full-width bar would say nothing. */}
          {segments.length > 1 && <SegmentBar label={SHARES_LABEL} segments={segments} />}
          <SegmentKey segments={segments} />
        </div>
      )}
    </div>
  );
}
