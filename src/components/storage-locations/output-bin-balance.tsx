"use client";
import { InfoHint } from "@/components/ui/tooltip";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { useOutputStockBalance, useOutputSubBins } from "@/hooks/use-output-stock";
import { formatMassKg } from "@/lib/format-utils";
import { formatWetEstimate } from "./stock-preview-shared";
import { MixPileCard } from "./mix-pile-card";
import { SubBinList } from "./sub-bin-card";

const WET_ESTIMATE_HINT = "Wet stock is the wet mass added to each sub-bin less the wet mass taken out. A delivery or loss keeps the sub-bin's moisture; only a count sets it again. Dry biochar limits what can leave.";

/**
 * An output bin's stock on its detail sheet, wet first: the wet estimate
 * operators plan loads by, the tracked dry biochar under it, then a split
 * bin's sub-bins oldest first. A mix bin is one pile, shown as one box.
 */
export function OutputBinBalance({ storageLocationId, facilityId }: { storageLocationId: string; facilityId: string }) {
  const preview = useOutputStockBalance({ storageLocationId, facilityId });
  // As of each fetch, like the balance above, so a new entry shows on refetch.
  const subBins = useOutputSubBins({ storageLocationId, facilityId });
  const clock = useFacilityClock(facilityId);
  const split = subBins.data?.stockMode === "split" && subBins.data.subBins.length > 0 ? subBins.data.subBins : null;
  const wetKg = preview.data?.beforeEstimatedWetKg ?? null;
  // Until the mode is known, show only the loading line, so the layout does not swap.
  if (subBins.isLoading) return <p role="status" className="body-caption">Loading stock...</p>;
  if (subBins.data?.stockMode === "mix" && preview.data) {
    return <MixPileCard binName={preview.data.binName} wetKg={wetKg} moisturePercent={preview.data.moistureEstimate?.moisturePercent ?? null}
      dryKg={preview.data.beforeDryKg} batches={subBins.data.subBins} />;
  }
  return <div className="space-y-16">
    <div className="space-y-4">
      {preview.isLoading && <p role="status" className="body-caption">Loading stock...</p>}
      {preview.error && <p role="alert" className="body-caption">{preview.error.message}</p>}
      {preview.data && <>
        <div className="flex items-center gap-6">
          <p className="body-small font-medium tabular-nums">{wetKg === null ? `${formatMassKg(preview.data.beforeDryKg)} dry biochar` : `≈ ${formatWetEstimate(wetKg)} kg wet in bin`}</p>
          <InfoHint label="About the wet estimate">{WET_ESTIMATE_HINT}</InfoHint>
        </div>
        {wetKg !== null && <p className="body-caption text-[var(--color-text-secondary)] tabular-nums">{formatMassKg(preview.data.beforeDryKg)} dry biochar</p>}
      </>}
    </div>
    {split && <section className="space-y-8" aria-labelledby={`sub-bins-${storageLocationId}`}>
      <h3 id={`sub-bins-${storageLocationId}`} className="body-small font-medium">Sub-bins, oldest first</h3>
      <SubBinList subBins={split} timeZone={clock.timeZone} label="Sub-bins, oldest first" />
    </section>}
    {subBins.error && <p role="alert" className="body-caption">{subBins.error.message}</p>}
  </div>;
}
