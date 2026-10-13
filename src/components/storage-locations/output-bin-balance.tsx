"use client";
import { EmptyState, Notice } from "@/components/ui";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { useOutputStockBalance, useOutputStockHistory, useOutputSubBins } from "@/hooks/use-output-stock";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { mixPileName } from "@/lib/output-stock/labels";
import { OutputStockHistory, outputStockSeries } from "./output-stock-history";
import { StockLevelChart } from "./stock-level-chart";
import { CardTextButton, StockCard, StockChartCard } from "./stock-card";
import { formatWetEstimate } from "./stock-preview-shared";
import { MixPileBay, SubBinBays, type PileBand } from "./sub-bin-bays";
import type { OutputSubBin } from "@/types/output-stock";
import { formatFacilityDateTime } from "@/lib/format-utils";

const SPLIT_HINT = "Wet stock is an estimate from the latest moisture reading of each sub-bin. Wet mass added less wet mass taken out determines the wet estimate; only a count resets moisture. Bays are drawn by wet mass, the hatched top being the estimated water, in the order a draw takes them.";
const MIX_HINT = "Wet stock is an estimate from the pile's latest moisture reading, drawn as the hatched water on top of the dry batches. Draws leave the estimated moisture unchanged. Each batch added brings its own wet mass.";
const SUB_BINS_LABEL = "Sub-bins, next out first";
const PERCENT = 100;
/** Below this a part is rounding, not a band worth drawing. */
const PILE_PART_MIN_KG = 0.05;

/**
 * A mix bin's pile from the bottom up: each batch's dry biochar, then any
 * ingredient solids (a product bin), then wet stock less those solids as
 * estimated water, so the bands add up to the wet estimate on the card.
 */
function mixPileBands(layers: OutputSubBin[], dryKg: number | null, wetKg: number | null, moisturePercent: number | null, timeZone: string): PileBand[] {
  const solidsKg = layers.reduce((sum, layer) => sum + layer.solidsKg, 0);
  const ingredientsKg = solidsKg - layers.reduce((sum, layer) => sum + layer.dryMassKg, 0);
  const waterKg = wetKg === null ? 0 : wetKg - solidsKg;
  return [
    ...layers.map((layer) => ({ label: layer.code, kg: layer.dryMassKg, details: [
      { label: "Share of dry biochar", value: dryKg ? `${Math.round((layer.dryMassKg / dryKg) * PERCENT)}%` : MISSING_VALUE.notAvailable },
      { label: "Dry biochar", value: formatMassKg(layer.dryMassKg) },
      { label: "Solids", value: formatMassKg(layer.solidsKg) },
      { label: "Added", value: formatFacilityDateTime(layer.placedAt, timeZone) },
    ] })),
    ...(ingredientsKg >= PILE_PART_MIN_KG ? [{ label: "Ingredients, dry", kg: ingredientsKg, category: "ingredient-solids" as const, details: [
      { label: "Ingredient solids", value: formatMassKg(ingredientsKg) },
    ] }] : []),
    ...(waterKg >= PILE_PART_MIN_KG ? [{ label: "Water, estimated", kg: waterKg, category: "existing-water" as const, details: [
      { label: "Water, estimated", value: formatMassKg(waterKg) },
      { label: "Moisture", value: moisturePercent === null ? MISSING_VALUE.notAvailable : formatMoisturePercent(moisturePercent) },
    ] }] : []),
  ];
}

/**
 * An output bin's stock card: the wet estimate operators plan loads by, the
 * tracked dry biochar under it, a split bin's sub-bins as bays or a mix bin
 * as one pile, then the stock action and the history.
 */
export function OutputBinBalance({ storageLocationId, facilityId, capacityKg, onAdjust }: {
  storageLocationId: string;
  facilityId: string;
  capacityKg: number | null;
  onAdjust?: () => void;
}) {
  const preview = useOutputStockBalance({ storageLocationId, facilityId });
  // As of each fetch, like the balance above, so a new entry shows on refetch.
  const subBins = useOutputSubBins({ storageLocationId, facilityId });
  const clock = useFacilityClock(facilityId);
  const mode = subBins.data?.stockMode;
  const layers = subBins.data?.subBins ?? [];
  const wetKg = preview.data?.beforeEstimatedWetKg ?? null;
  const dryKg = preview.data?.beforeDryKg ?? null;
  const mixMoisture = mode === "mix" ? preview.data?.moistureEstimate?.moisturePercent ?? null : null;
  const ready = !!preview.data && !subBins.isLoading;
  // Shares the history modal's query, so opening it shows the same data at once.
  const history = useOutputStockHistory(storageLocationId);
  const series = history.data ? outputStockSeries(history.data) : null;

  return <div className="flex flex-col gap-16">
    <StockCard
      title={mode === "mix" && preview.data ? mixPileName(preview.data.binName) : "Stock"}
      hint={mode === "mix" ? MIX_HINT : SPLIT_HINT}
      status={<>
        {(subBins.isLoading || preview.isLoading) && <p role="status" className="body-caption">Loading stock...</p>}
        {preview.error && <Notice tone="error">{preview.error.message}</Notice>}
        {subBins.error && <Notice tone="error">{subBins.error.message}</Notice>}
      </>}
      figure={ready && <>
        {wetKg === null ? MISSING_VALUE.notAvailable : `≈ ${formatWetEstimate(wetKg)} kg wet`}
        {capacityKg != null && <span className="body-small text-[var(--color-text-tertiary)]"> of {formatMassKg(capacityKg)}</span>}
      </>}
      caption={ready && <>
        {mode === "mix" && `${mixMoisture === null ? MISSING_VALUE.notAvailable : formatMoisturePercent(mixMoisture)} moisture · `}
        {dryKg === null ? MISSING_VALUE.notAvailable : formatMassKg(dryKg)} dry biochar
      </>}
      onAdjust={onAdjust}
    >
      {ready && layers.length === 0 && <EmptyState icon={null} title="No stock in this bin" padding="sm" />}
      {!subBins.isLoading && layers.length > 0 && (mode === "mix"
        ? <MixPileBay bands={mixPileBands(layers, dryKg, wetKg, mixMoisture, clock.timeZone)} capacityKg={capacityKg} />
        : <SubBinBays subBins={layers} timeZone={clock.timeZone} label={SUB_BINS_LABEL} capacityKg={capacityKg} />)}
    </StockCard>
    <StockChartCard history={<OutputStockHistory storageLocationId={storageLocationId} facilityId={facilityId}
      renderTrigger={(open, icon) => <CardTextButton icon={icon} onClick={open}>History</CardTextButton>} />}>
      {history.error ? <Notice tone="error">{history.error.message}</Notice> : history.isLoading ? <p role="status" className="body-caption">Loading stock history</p> : series && series.points.length > 1 ? <StockLevelChart compact points={series.points} modeChanges={series.modeChanges} timeZone={clock.timeZone} now={history.dataUpdatedAt} /> : undefined}
    </StockChartCard>
  </div>;
}
