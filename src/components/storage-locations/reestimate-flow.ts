import type { MassFlowDiagram, MassFlowSegment } from "@/components/ui/mass-flow-sankey";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type { AffectedStockPreview as Preview } from "@/types/output-stock";
import type { StockEntryKind } from "./output-stock-preview";

const PERCENT = 100;
/** Water below this is rounding noise, not a band worth drawing. */
const MIN_WATER_KG = 0.05;

/** What a re-estimate belongs to: an entry kind from the stock forms, or the biochar a product takes from its source bin. */
export type ReestimateKind = Exclude<StockEntryKind, "count"> | "biochar";

/** One sub-bin whose estimate saving resets, at the draw's own reading. */
export interface ReestimatedLayer {
  layerId: string;
  name: string;
  moisturePercent: number;
}

/**
 * The figures behind a re-estimating draw, all in kg of wet mass or total
 * solids (dry biochar plus ingredient solids), so a blend's ingredients never
 * read as water.
 */
export interface ReestimateFigures {
  /** The draw's reading when every re-estimated sub-bin shares it; null when they differ. */
  moisturePercent: number | null;
  layers: ReestimatedLayer[];
  /** True when the re-estimate covers everything that stays: a mix pile, or every held sub-bin. */
  wholeBin: boolean;
  binWetKg: number;
  binSolidsKg: number;
  removedWetKg: number;
  removedSolidsKg: number;
  stayWetKg: number;
  staySolidsKg: number;
}

/** Solids below this are the same bin to the operator; tells a whole-bin re-estimate from a part. */
const SAME_SOLIDS_KG = 0.05;

/** Null unless saving this movement re-estimates what stays and every figure is known. */
export function reestimateFigures(preview: Preview): ReestimateFigures | null {
  const { reestimate, beforeEstimatedWetKg, afterEstimatedWetKg, beforeSolidsKg, afterSolidsKg, removedWetKg } = preview;
  if (!reestimate || preview.blockingMessage !== null) return null;
  if (beforeEstimatedWetKg === null || afterEstimatedWetKg === null || removedWetKg === null || beforeSolidsKg === null) return null;
  const layerSolidsKg = reestimate.layers.reduce((sum, layer) => sum + layer.staySolidsKg, 0);
  return {
    moisturePercent: reestimate.moisturePercent,
    layers: reestimate.layers.map(({ layerId, name, moisturePercent }) => ({ layerId, name, moisturePercent })),
    wholeBin: preview.stockMode === "mix" || Math.abs(layerSolidsKg - reestimate.staySolidsKg) < SAME_SOLIDS_KG,
    binWetKg: beforeEstimatedWetKg, binSolidsKg: beforeSolidsKg,
    removedWetKg: Math.abs(removedWetKg), removedSolidsKg: Math.abs(preview.removedSolidsKg ?? beforeSolidsKg - (afterSolidsKg ?? beforeSolidsKg)),
    stayWetKg: afterEstimatedWetKg, staySolidsKg: reestimate.staySolidsKg,
  };
}

/** True while the preview shows the re-estimate notice, so a form can leave the same advice off its own fields. */
export function showsReestimate(preview: Preview | null | undefined): boolean {
  return preview != null && reestimateFigures(preview) !== null;
}

/** Moisture of a wet figure that holds `solidsKg` of solids, as the percent the bin card shows. */
export function moistureOf(wetKg: number, solidsKg: number): number {
  return wetKg > 0 ? ((wetKg - solidsKg) / wetKg) * PERCENT : 0;
}

const REMOVED_NAME: Record<ReestimateKind, string> = { loss: "Lost mass", delivery: "Delivery", correction: "Removed", biochar: "Biochar drawn" };

function segments(parts: readonly MassFlowSegment[]): MassFlowSegment[] {
  return parts.filter((part) => part.kg >= MIN_WATER_KG);
}

/**
 * The mini flow: the bin's estimate (dry biochar that stays, dry biochar that
 * leaves, its water) into what stays and what leaves. The draw is wetter
 * than the estimate, so its water has to come from somewhere: the bin's own
 * water first, and the rest from a source of its own, "Water not in the
 * estimate", so the gap shows as mass the estimate never had.
 */
export function reestimateFlow(figures: ReestimateFigures, binName: string, kind: ReestimateKind): MassFlowDiagram {
  const binWaterKg = Math.max(figures.binWetKg - figures.binSolidsKg, 0);
  const removedWaterKg = Math.max(figures.removedWetKg - figures.removedSolidsKg, 0);
  const stayWaterKg = Math.max(figures.stayWetKg - figures.staySolidsKg, 0);
  const toRemovedKg = Math.min(binWaterKg, removedWaterKg);
  const toStayKg = Math.min(binWaterKg - toRemovedKg, stayWaterKg);
  const missingToRemovedKg = removedWaterKg - toRemovedKg;
  const missingToStayKg = stayWaterKg - toStayKg;
  const missingKg = missingToRemovedKg + missingToStayKg;
  // A split bin re-estimates only the sub-bins the draw reached; the rest of what stays keeps its own estimate, so its moisture is not one figure.
  const stays = figures.wholeBin && figures.moisturePercent !== null
    ? { name: "Stays, re-estimated", caption: `≈ ${formatMassKg(figures.stayWetKg)} at ${formatMoisturePercent(figures.moisturePercent)}` }
    : { name: "Stays", caption: `≈ ${formatMassKg(figures.stayWetKg)}` };
  const nodes: MassFlowDiagram["nodes"] = [
    { id: "bin", column: 0, name: binName, caption: `≈ ${formatMassKg(figures.binWetKg)} at ${formatMoisturePercent(moistureOf(figures.binWetKg, figures.binSolidsKg))}`, segments: segments([
      { id: "bin-dry-stays", kg: figures.staySolidsKg, kind: "dry" },
      { id: "bin-dry-removed", kg: figures.removedSolidsKg, kind: "dry" },
      { id: "bin-water-removed", kg: toRemovedKg, kind: "water" },
      { id: "bin-water-stays", kg: toStayKg, kind: "water" },
    ]) },
    ...(missingKg >= MIN_WATER_KG ? [{ id: "missing", column: 0, name: "Water not in the estimate", caption: formatMassKg(missingKg), segments: segments([
      { id: "missing-stays", kg: missingToStayKg, kind: "water" },
      { id: "missing-removed", kg: missingToRemovedKg, kind: "water" },
    ]) }] : []),
    { id: "stays", column: 1, ...stays, segments: segments([
      { id: "stays-dry", kg: figures.staySolidsKg, kind: "dry" },
      { id: "stays-water", kg: toStayKg, kind: "water" },
      { id: "stays-water-missing", kg: missingToStayKg, kind: "water" },
    ]) },
    { id: "removed", column: 1, name: REMOVED_NAME[kind], caption: `${formatMassKg(figures.removedWetKg)} at ${formatMoisturePercent(moistureOf(figures.removedWetKg, figures.removedSolidsKg))}`, segments: segments([
      { id: "removed-dry", kg: figures.removedSolidsKg, kind: "dry" },
      { id: "removed-water", kg: toRemovedKg, kind: "water" },
      { id: "removed-water-missing", kg: missingToRemovedKg, kind: "water" },
    ]) },
  ];
  const has = (id: string) => nodes.some((node) => node.segments.some((segment) => segment.id === id));
  const link = (from: string, to: string) => has(from) && has(to) ? [{ from, to }] : [];
  return {
    nodes,
    links: [
      ...link("bin-dry-stays", "stays-dry"),
      ...link("bin-dry-removed", "removed-dry"),
      ...link("bin-water-removed", "removed-water"),
      ...link("bin-water-stays", "stays-water"),
      ...link("missing-stays", "stays-water-missing"),
      ...link("missing-removed", "removed-water-missing"),
    ],
  };
}
