"use client";
import { EmptyState, Notice } from "@/components/ui";
import { SecondaryFigure } from "@/components/ui/secondary-figure";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { useLinkedOutputBinInventory, useOutputStockBalance, useOutputStockHistory, useOutputSubBins } from "@/hooks/use-output-stock";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { moistureDrawCaption } from "@/lib/output-stock/moisture-guidance";
import { DRY_BIOCHAR_LABEL } from "@/components/biochar-products/product-composition-components";
import { mixPileName, WET_STOCK_DEFINITION } from "@/lib/output-stock/labels";
import { OutputStockHistory } from "./output-stock-history";
import { StockLevelChart } from "./stock-level-chart";
import { estimateKg } from "./output-stock-history-days";
import { buildStockLevelSeries } from "./stock-level-series";
import { CardTextButton, StockCard, StockChartCard } from "./stock-card";
import { outputStockFigure } from "./stock-preview-shared";
import { MixPileBay, SubBinBays, type PileBand } from "./sub-bin-bays";
import { partFigure, partLabel, partRows } from "./sub-bin-card";
import { pileFigures, stockParts } from "@/lib/output-stock/stock-parts";
import type { OutputSubBin } from "@/types/output-stock";
import type { MoistureBasis } from "@/lib/output-stock/moisture-estimate";
import { formatFacilityDateTime } from "@/lib/format-utils";

const SPLIT_CAPTION = `Each bay is a sub-bin, drawn by wet mass with its water hatched on top, in the order draws take them.`;
const MIX_CAPTION = `The water is hatched on top of the dry batches.`;
const SUB_BINS_LABEL = "Sub-bins, next out first";
const PERCENT = 100;

/**
 * A mix bin's pile from the bottom up: each batch's dry biochar, then each
 * ingredient's solids across the batches (a product bin), then wet stock less
 * those solids as estimated water, so the bands add up to the wet estimate on
 * the card. Parts are named the way the product composition names them.
 */
export function mixPileBands(layers: OutputSubBin[], dryKg: number | null, wetKg: number | null, moisturePercent: number | null, timeZone: string): PileBand[] {
  const parts = stockParts(pileFigures(layers, wetKg));
  return [
    ...layers.map((layer) => ({ label: layer.code, kg: layer.dryMassKg, details: [
      // A share is derived, so a bin without dry stock leaves the row out.
      ...(dryKg ? [{ label: "Share of dry biochar", value: `${Math.round((layer.dryMassKg / dryKg) * PERCENT)}%` }] : []),
      // A batch in a pile has no wet estimate of its own, so it has no water row.
      ...partRows(stockParts(pileFigures([layer], null)).rows),
      { label: "Added", value: formatFacilityDateTime(layer.placedAt, timeZone) },
    ] })),
    ...parts.rows.filter((part) => part.kind === "ingredient").map((part) => ({ label: partLabel(part), kg: part.kg, category: "ingredient-solids" as const, details: [
      { label: partLabel(part), value: formatMassKg(part.kg) },
    ] })),
    ...parts.rows.filter((part) => part.kind === "water").map((part) => ({ label: partLabel(part), kg: part.kg, category: "existing-water" as const, estimated: true, details: [
      { label: partLabel(part), value: partFigure(part) },
      // The pile's moisture is an estimate, so without one the row is left out.
      ...(moisturePercent === null ? [] : [{ label: "Moisture", value: formatMoisturePercent(moisturePercent) }]),
    ] })),
  ];
}

/**
 * The newest draw that set the bin's moisture estimate, across the bin and
 * its sub-bins; null when every estimate still rests on a count or on intake.
 */
export function drawMoistureBasis(bases: readonly (MoistureBasis | null | undefined)[]): MoistureBasis | null {
  const draws = bases.filter((basis): basis is MoistureBasis & { source: "draw" } => basis?.source === "draw");
  return draws.reduce<(MoistureBasis & { source: "draw" }) | null>((newest, basis) => !newest || basis.at > newest.at ? basis : newest, null);
}

/**
 * An output bin's stock card: the wet estimate operators plan loads by, the
 * tracked dry biochar under it, a split bin's sub-bins as bays or a mix bin
 * as one pile, then the stock action and the history.
 */
export function OutputBinBalance({ storageLocationId, facilityId, capacityKg, onAdjust, readOnly = false, timeZone }: {
  storageLocationId: string;
  facilityId: string;
  capacityKg: number | null;
  onAdjust?: () => void;
  /** Hides the history's Lost mass Edit and Delete; the history stays visible. */
  readOnly?: boolean;
  /** The record's own zone when its facility is archived and outside the facility list. */
  timeZone?: string;
}) {
  const bin = { storageLocationId, facilityId };
  // A read-only bin (archived facility) reads its stock through the linked read; the live reads need an active bin.
  const linked = useLinkedOutputBinInventory(readOnly ? bin : null);
  const liveBalance = useOutputStockBalance(readOnly ? null : bin);
  // As of each fetch, like the balance above, so a new entry shows on refetch.
  const liveSubBins = useOutputSubBins(readOnly ? null : bin);
  const preview = readOnly ? { data: linked.data?.balance, isLoading: linked.isLoading, error: linked.error } : liveBalance;
  const subBins = readOnly ? { data: linked.data?.contents, isLoading: linked.isLoading, error: linked.error } : liveSubBins;
  const clock = useFacilityClock(facilityId);
  const zone = timeZone ?? clock.timeZone;
  const mode = subBins.data?.stockMode;
  const layers = subBins.data?.subBins ?? [];
  const wetKg = preview.data?.beforeEstimatedWetKg ?? null;
  const dryKg = preview.data?.beforeDryKg ?? null;
  const basisCaption = moistureDrawCaption(drawMoistureBasis([preview.data?.moistureEstimate?.basis, ...layers.map((layer) => layer.basis)]), zone);
  const mixMoisture = mode === "mix" ? preview.data?.moistureEstimate?.moisturePercent ?? null : null;
  const ready = !!preview.data && !subBins.isLoading;
  // Shares the history modal's query, so opening it shows the same data at once.
  const history = useOutputStockHistory(storageLocationId);
  const series = history.data ? buildStockLevelSeries(history.data) : null;

  return <div className="flex flex-col gap-16">
    <StockCard
      title={mode === "mix" && preview.data ? mixPileName(preview.data.binName) : "Stock"}
      hint={WET_STOCK_DEFINITION}
      status={<>
        {(subBins.isLoading || preview.isLoading) && <p role="status" className="body-caption">Loading stock...</p>}
        {preview.error && <Notice tone="error">{preview.error.message}</Notice>}
        {subBins.error && <Notice tone="error">{subBins.error.message}</Notice>}
      </>}
      figure={ready && <>
        {outputStockFigure(wetKg, dryKg ?? 0)}
        {capacityKg != null && <span className="body-small text-[var(--color-text-tertiary)]"> of {formatMassKg(capacityKg)}</span>}
      </>}
      caption={ready && wetKg !== null && dryKg !== null && <>
        <SecondaryFigure label={DRY_BIOCHAR_LABEL} value={formatMassKg(dryKg)} />
        {basisCaption && <span className="block">{basisCaption}</span>}
      </>}
      onAdjust={onAdjust}
    >
      {ready && layers.length === 0 && <EmptyState icon={null} title="No stock in this bin" padding="sm" />}
      {!subBins.isLoading && layers.length > 0 && (mode === "mix"
        ? <MixPileBay bands={mixPileBands(layers, dryKg, wetKg, mixMoisture, zone)} capacityKg={capacityKg} />
        : <SubBinBays subBins={layers} timeZone={zone} label={SUB_BINS_LABEL} capacityKg={capacityKg} />)}
      {!subBins.isLoading && layers.length > 0 && <p className="body-caption text-[var(--color-text-secondary)]">{mode === "mix" ? MIX_CAPTION : SPLIT_CAPTION}</p>}
    </StockCard>
    <StockChartCard history={<OutputStockHistory storageLocationId={storageLocationId} facilityId={facilityId} readOnly={readOnly} balance={readOnly ? preview.data : undefined} timeZone={zone}
      renderTrigger={(open, icon) => <CardTextButton icon={icon} onClick={open}>History</CardTextButton>} />}>
      {history.error ? <Notice tone="error">{history.error.message}</Notice> : history.isLoading ? <p role="status" className="body-caption">Loading stock history</p> : series && series.points.length > 1 ? <StockLevelChart compact points={series.points} modeChanges={series.modeChanges} timeZone={zone} now={history.dataUpdatedAt} formatEstimate={estimateKg} /> : undefined}
    </StockChartCard>
  </div>;
}
