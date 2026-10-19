/**
 * An output bin's stock drawn as bins. A split bin keeps each batch apart, so
 * each sub-bin is its own bin, side by side in draw order, filled by its wet
 * estimate against the largest sub-bin. A mix bin is one pile, so it is one
 * bin with the batches behind it as an accounting split. Where only one bin
 * is drawn, its parts are listed beside it, folding under it on a narrow
 * card; several bins wrap onto the next line with the key under them.
 */
"use client";

import { Button } from "@/components/ui/button";
import { DropIcon } from "@phosphor-icons/react/dist/ssr";
import type { CSSProperties, ReactNode } from "react";
import { MASS_CATEGORY_FILLS, formatCompositionMass, type MassCategory, type MassSegment } from "@/components/forms/composition-ledger";
import { SegmentKey, batchAccentFill } from "@/components/ui/segment-bar";
import { STOCK_PART_MIN_KG } from "@/config/output-stock";
import { formatFacilityTime } from "@/lib/date-utils";
import { DRY_BIOCHAR_LABEL } from "@/components/biochar-products/product-composition-components";
import { ESTIMATED_WATER_LABEL, INGREDIENT_SOLIDS_LABEL } from "@/lib/output-stock/labels";
import type { OutputSubBin } from "@/types/output-stock";
import { formatWetEstimate } from "./stock-preview-shared";
import { DetailsTooltip, SubBinTooltip, ingredientSolidsParts, subBinMoistureText } from "./sub-bin-card";

/** How much of a batch accent a bay's fill carries, so the figure on it stays legible. */
const BAY_TINT_PERCENT = 32;
const SHARES_LABEL = "Dry biochar by batch";
/** Batches listed beside a pile before the rest fold into one line. */
const PILE_LIST_LIMIT = 6;
/** Bays are narrow; the day added is enough, the full time sits in its details. */
const BAY_DATE_FORMAT = "MMM d";
const PERCENT = 100;

function bayTint(index: number): string {
  return `color-mix(in srgb, ${batchAccentFill(index)} ${BAY_TINT_PERCENT}%, transparent)`;
}

/** The mass a bay is sized by: the wet estimate, or solids when nothing dates the moisture. */
function bayMassKg(subBin: OutputSubBin): number {
  return subBin.wetEstimateKg ?? subBin.solidsKg;
}

function bayWaterKg(subBin: OutputSubBin): number {
  return subBin.wetEstimateKg === null ? 0 : Math.max(subBin.wetEstimateKg - subBin.solidsKg, 0);
}

function bayIngredientsKg(subBin: OutputSubBin): number {
  return Math.max(subBin.solidsKg - subBin.dryMassKg, 0);
}

function bayFigure(subBin: OutputSubBin): string {
  return subBin.wetEstimateKg === null ? `${formatWetEstimate(subBin.dryMassKg)} dry` : formatWetEstimate(subBin.wetEstimateKg);
}

/**
 * The bin itself: two walls and a floor, with a rim lipping out at the top so
 * it reads as a container, not a bar. The fill sits on the floor.
 */
function BinVessel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`relative flex h-[136px] flex-col justify-end border-x-2 border-b-2 border-[var(--clr-dark-purple-60)] group-hover:border-[var(--clr-dark-purple-80)] ${className}`}>
      <span aria-hidden="true" className="absolute -left-8 -top-px h-2 w-8 bg-[var(--clr-dark-purple-60)] group-hover:bg-[var(--clr-dark-purple-80)]" />
      <span aria-hidden="true" className="absolute -right-8 -top-px h-2 w-8 bg-[var(--clr-dark-purple-60)] group-hover:bg-[var(--clr-dark-purple-80)]" />
      {children}
    </span>
  );
}

interface PartRow {
  label: string;
  kg: number;
  details?: PileBand["details"];
  swatchClassName?: string;
  swatchStyle?: CSSProperties;
}

/** The parts beside a lone bin, top to bottom in the order they sit in it, each with its mass and share. */
function BinParts({ rows, label }: { rows: PartRow[]; label: string }) {
  const totalKg = rows.reduce((sum, row) => sum + Math.max(row.kg, 0), 0);
  return (
    <dl aria-label={label} className="grid min-w-0 max-w-[320px] flex-1 basis-[200px] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-8 gap-y-6 body-caption tabular-nums">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="flex min-w-0 items-center gap-8 text-[var(--color-text-secondary)]">
            <span aria-hidden="true" className={`h-12 w-12 shrink-0 border border-[var(--color-border-secondary)] ${row.swatchClassName ?? ""}`} style={row.swatchStyle} />
            {row.details ? <DetailsTooltip title={row.label} rows={row.details} trigger={
              <Button type="button" variant="noOutline" className="h-auto min-h-44 min-w-0 justify-start p-0" aria-label={`${row.label} details`}>
                {/* The button's own label type is mono caps; the part reads like the rows without details. */}
                <span className="truncate body-caption normal-case text-[var(--color-text-secondary)]">{row.label}</span>
              </Button>
            } /> : <span className="truncate">{row.label}</span>}
          </dt>
          <dd className="text-right font-medium">{formatCompositionMass(row.kg)}</dd>
          <dd className="w-40 text-right text-[var(--color-text-tertiary)]">{totalKg > 0 ? `${Math.round((Math.max(row.kg, 0) / totalKg) * PERCENT)}%` : ""}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One sub-bin as a bin: water on top, then ingredient solids, then its dry biochar. */
function SubBinBay({ subBin, index, percent, nextOut, timeZone }: { subBin: OutputSubBin; index: number; percent: number; nextOut: boolean; timeZone: string }) {
  const totalKg = bayMassKg(subBin);
  const share = (kg: number) => (totalKg > 0 ? (kg / totalKg) * PERCENT : 0);
  return (
    <span className="flex w-[120px] min-w-0 max-w-full flex-col gap-4">
      {/* Reserved on every bay so the bins share one top edge. */}
      <span className="h-18 body-caption">{nextOut && <span className="border border-[var(--color-text-primary)] px-4">Next out</span>}</span>
      <SubBinTooltip subBin={subBin} timeZone={timeZone} trigger={
        <Button type="button" variant="noOutline" aria-label={`${subBin.code} details`}
          className="group flex h-auto min-w-0 flex-col items-stretch gap-6 px-8 py-0 text-left whitespace-normal hover:bg-transparent cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]">
          <BinVessel>
            <span className="absolute inset-x-0 top-4 text-center body-caption font-medium">{bayFigure(subBin)}</span>
            <span aria-hidden="true" className="flex flex-col" style={{ height: `${percent}%` }}>
              {bayWaterKg(subBin) > 0 && <span className={`block border-b border-[var(--color-border-secondary)] ${MASS_CATEGORY_FILLS["existing-water"]}`} style={{ height: `${share(bayWaterKg(subBin))}%` }} />}
              {bayIngredientsKg(subBin) > 0 && <span className={`block ${MASS_CATEGORY_FILLS["ingredient-solids"]}`} style={{ height: `${share(bayIngredientsKg(subBin))}%` }} />}
              <span className="block flex-1" style={{ background: bayTint(index) }} />
            </span>
          </BinVessel>
          <span className="flex min-w-0 flex-col">
            <span className="truncate body-caption font-medium">{subBin.code}</span>
            <span className="inline-flex items-center gap-2 body-caption text-[var(--color-text-tertiary)]">
              <DropIcon size={12} aria-label="Estimated moisture" />{subBinMoistureText(subBin)}
            </span>
            <span className="body-caption normal-case text-[var(--color-text-tertiary)]">{formatFacilityTime(new Date(subBin.placedAt), timeZone, BAY_DATE_FORMAT)}</span>
          </span>
        </Button>
      } />
    </span>
  );
}

/** A split bin's sub-bins as bins, in default draw order: the first is the next one out. Hover or tap a bin for its details. */
export function SubBinBays({ subBins, timeZone, label, capacityKg }: { subBins: OutputSubBin[]; timeZone: string; label: string; capacityKg?: number | null }) {
  const ingredientsKg = subBins.reduce((sum, subBin) => sum + bayIngredientsKg(subBin), 0);
  const waterKg = subBins.reduce((sum, subBin) => sum + bayWaterKg(subBin), 0);
  if (subBins.length === 1) {
    const [subBin] = subBins;
    return (
      <div className="flex flex-wrap items-center gap-x-16 gap-y-12">
        <ul aria-label={label} className="tabular-nums"><li><SubBinBay subBin={subBin} index={0} percent={capacityKg && capacityKg > 0 ? Math.min(bayMassKg(subBin) / capacityKg, 1) * PERCENT : PERCENT} nextOut={false} timeZone={timeZone} /></li></ul>
        <BinParts label={`${subBin.code} contents`} rows={[
          ...(waterKg >= STOCK_PART_MIN_KG ? [{ label: ESTIMATED_WATER_LABEL, kg: waterKg, swatchClassName: MASS_CATEGORY_FILLS["existing-water"] }] : []),
          ...ingredientSolidsParts(subBin.ingredients, bayIngredientsKg(subBin)).map((part) => ({ ...part, swatchClassName: MASS_CATEGORY_FILLS["ingredient-solids"] })),
          { label: DRY_BIOCHAR_LABEL, kg: subBin.dryMassKg, swatchStyle: { background: bayTint(0) } },
        ]} />
      </div>
    );
  }
  const largestKg = Math.max(...subBins.map(bayMassKg), 0);
  // The batch codes name themselves under each bin; the key covers the parts every bin shares.
  const sharedParts: MassSegment[] = [
    { label: INGREDIENT_SOLIDS_LABEL, mass: ingredientsKg, category: "ingredient-solids" as const },
    { label: ESTIMATED_WATER_LABEL, mass: waterKg, category: "existing-water" as const },
  ].filter((part) => part.mass >= STOCK_PART_MIN_KG);
  return (
    <div className="flex flex-col gap-8">
      <ul aria-label={label} className="flex flex-wrap gap-x-8 gap-y-16 tabular-nums">
        {subBins.map((subBin, index) => (
          <li key={subBin.layerId} className="flex min-w-0">
            <SubBinBay subBin={subBin} index={index} percent={largestKg > 0 ? (bayMassKg(subBin) / largestKg) * PERCENT : 0} nextOut={index === 0} timeZone={timeZone} />
          </li>
        ))}
      </ul>
      {sharedParts.length > 0 && <SegmentKey segments={sharedParts} />}
    </div>
  );
}

/** One batch in a pooled pile: its share and what its hover shows. */
export interface PileBand {
  label: string;
  kg: number;
  details: { label: string; value: string }[];
  /** A part that is not a batch (ingredient solids, water) takes its category's fill; batches take a batch accent. */
  category?: Exclude<MassCategory, "dry-batch">;
}

function bandSwatch(band: PileBand, index: number): Pick<PartRow, "swatchClassName" | "swatchStyle"> {
  return band.category ? { swatchClassName: MASS_CATEGORY_FILLS[band.category] } : { swatchStyle: { background: bayTint(index) } };
}

/**
 * A pooled bin as the one pile it is. The batches behind it are an accounting
 * split, not separate heaps, so they stack as bands inside the one bin, oldest
 * at the bottom. Ingredient solids and the estimated water go on top, so the
 * pile's top edge reads as its wet stock. The parts are listed beside the bin
 * from the top down; past `PILE_LIST_LIMIT` batches the oldest fold into one
 * line. Hover or tap a band for its details.
 */
export function MixPileBay({ bands, label = SHARES_LABEL, capacityKg = null }: { bands: PileBand[]; label?: string; capacityKg?: number | null }) {
  const total = bands.reduce((sum, band) => sum + Math.max(band.kg, 0), 0);
  const fillPercent = capacityKg && capacityKg > 0 ? Math.min(total / capacityKg, 1) * PERCENT : PERCENT;
  const parts = bands.map((band, index) => ({ band, index })).filter(({ band }) => band.category);
  const batches = bands.map((band, index) => ({ band, index })).filter(({ band }) => !band.category).toReversed();
  const listed = batches.slice(0, PILE_LIST_LIMIT);
  const folded = batches.slice(PILE_LIST_LIMIT);
  const rows: PartRow[] = [
    ...[...parts, ...listed].toSorted((a, b) => b.index - a.index).map(({ band, index }) => ({ label: band.label, kg: band.kg, details: band.details, ...bandSwatch(band, index) })),
    ...(folded.length > 0 ? [{ label: `${folded.length} older batches`, kg: folded.reduce((sum, { band }) => sum + band.kg, 0), swatchClassName: "bg-[var(--clr-dark-purple-10)]", details: folded.map(({ band }) => ({ label: band.label, value: formatCompositionMass(band.kg) })) }] : []),
  ];
  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-16 gap-y-12">
      <BinVessel className="mx-8 w-[112px] shrink-0">
        <ul aria-label={label} className="flex flex-col-reverse" style={{ height: `${fillPercent}%` }}>
          {bands.map((band, index) => (
            <li key={band.label} className="flex min-h-0" style={{ height: `${total > 0 ? (Math.max(band.kg, 0) / total) * PERCENT : 0}%` }}>
              <DetailsTooltip title={band.label} rows={band.details} trigger={
                <Button type="button" variant="noOutline" aria-label={`${band.label} details`}
                  className={`h-full min-h-0 w-full p-0 cursor-help hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-interaction)] ${index > 0 ? "border-b border-[var(--color-background-white)]" : ""} ${band.category ? MASS_CATEGORY_FILLS[band.category] : ""}`}
                  style={band.category ? undefined : { background: bayTint(index) }} />
              } />
            </li>
          ))}
        </ul>
      </BinVessel>
      {rows.length > 0 && <BinParts label={`${label}, top to bottom`} rows={rows} />}
    </div>
  );
}
