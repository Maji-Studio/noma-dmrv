"use client";
import { EmptyState, Notice } from "@/components/ui";
import { SecondaryFigure } from "@/components/ui/secondary-figure";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { useOutputStockBalance, useOutputStockHistory, useOutputSubBins } from "@/hooks/use-output-stock";
import { STOCK_PART_MIN_KG } from "@/config/output-stock";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { DRY_BIOCHAR_LABEL, ingredientSolidsLabel } from "@/components/biochar-products/product-composition-components";
import { ESTIMATED_WATER_LABEL, INGREDIENT_SOLIDS_LABEL, mixPileName } from "@/lib/output-stock/labels";
import { OutputStockHistory } from "./output-stock-history";
import { StockLevelChart } from "./stock-level-chart";
import { buildStockLevelSeries } from "./stock-level-series";
import { CardTextButton, StockCard, StockChartCard } from "./stock-card";
import { formatWetEstimate } from "./stock-preview-shared";
import { MixPileBay, SubBinBays, type PileBand } from "./sub-bin-bays";
import { contentsRows } from "./sub-bin-card";
import type { OutputSubBin } from "@/types/output-stock";
import { formatFacilityDateTime } from "@/lib/format-utils";

const SPLIT_HINT = "Wet stock is an estimate: the wet mass added less the wet mass taken out, at the moisture last recorded for each sub-bin. Draws and lost mass leave that moisture as it was, so wet stock reads high once the stock dries. Bays are drawn by wet mass, the hatched top being the estimated water, in the order a draw takes them.";
const MIX_HINT = "Wet stock is an estimate: the wet mass added less the wet mass taken out. Each batch added brings its own wet mass and moisture. Draws and lost mass leave the pile's moisture as it was, so wet stock reads high once the stock dries. The hatched water sits on top of the dry batches.";
const SUB_BINS_LABEL = "Sub-bins, next out first";
const PERCENT = 100;

/**
 * A mix bin's pile from the bottom up: each batch's dry biochar, then each
 * ingredient's solids across the batches (a product bin), then wet stock less
 * those solids as estimated water, so the bands add up to the wet estimate on
 * the card. Parts are named the way the product composition names them.
 */
export function mixPileBands(layers: OutputSubBin[], dryKg: number | null, wetKg: number | null, moisturePercent: number | null, timeZone: string): PileBand[] {
  const solidsKg = layers.reduce((sum, layer) => sum + layer.solidsKg, 0);
  const ingredientsKg = solidsKg - layers.reduce((sum, layer) => sum + layer.dryMassKg, 0);
  const byIngredient = new Map<string, number>();
  for (const ingredient of layers.flatMap((layer) => layer.ingredients)) byIngredient.set(ingredient.name, (byIngredient.get(ingredient.name) ?? 0) + ingredient.solidsKg);
  const named = [...byIngredient].map(([name, kg]) => ({ label: ingredientSolidsLabel(name), kg })).filter((part) => part.kg >= STOCK_PART_MIN_KG);
  // What the named bands leave out (rounding, a product read without its lines) stays one part, so the bands still add up.
  const restKg = ingredientsKg - named.reduce((sum, part) => sum + part.kg, 0);
  const ingredientBands = restKg >= STOCK_PART_MIN_KG ? [...named, { label: INGREDIENT_SOLIDS_LABEL, kg: restKg }] : named;
  const waterKg = wetKg === null ? 0 : wetKg - solidsKg;
  return [
    ...layers.map((layer) => ({ label: layer.code, kg: layer.dryMassKg, details: [
      { label: "Share of dry biochar", value: dryKg ? `${Math.round((layer.dryMassKg / dryKg) * PERCENT)}%` : MISSING_VALUE.notAvailable },
      // A batch in a pile has no wet estimate of its own, so it has no water row.
      ...contentsRows({ dryMassKg: layer.dryMassKg, ingredients: layer.ingredients, waterKg: null }),
      { label: "Added", value: formatFacilityDateTime(layer.placedAt, timeZone) },
    ] })),
    ...ingredientBands.map((part) => ({ ...part, category: "ingredient-solids" as const, details: [
      { label: part.label, value: formatMassKg(part.kg) },
    ] })),
    ...(waterKg >= STOCK_PART_MIN_KG ? [{ label: ESTIMATED_WATER_LABEL, kg: waterKg, category: "existing-water" as const, details: [
      { label: ESTIMATED_WATER_LABEL, value: formatMassKg(waterKg) },
      { label: "Moisture", value: moisturePercent === null ? MISSING_VALUE.notAvailable : formatMoisturePercent(moisturePercent) },
    ] }] : []),
  ];
}

/**
 * The card's headline: the wet estimate operators find on site. Without one,
 * the dry biochar the bin tracks is the only honest figure and takes its place,
 * as it does on the board's tile.
 */
function stockFigure(wetKg: number | null, dryKg: number | null): string {
  if (wetKg !== null) return `≈ ${formatWetEstimate(wetKg)} kg wet`;
  return dryKg === null ? MISSING_VALUE.notAvailable : `${formatMassKg(dryKg)} dry biochar`;
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
  const series = history.data ? buildStockLevelSeries(history.data) : null;

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
        {stockFigure(wetKg, dryKg)}
        {capacityKg != null && <span className="body-small text-[var(--color-text-tertiary)]"> of {formatMassKg(capacityKg)}</span>}
      </>}
      // Dry biochar sits under the wet figure only while wet leads; without a wet estimate it is the headline itself.
      caption={ready && wetKg !== null && dryKg !== null && <SecondaryFigure label={DRY_BIOCHAR_LABEL} value={formatMassKg(dryKg)} />}
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
