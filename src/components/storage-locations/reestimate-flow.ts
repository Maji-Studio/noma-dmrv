import type { MassFlowDiagram, MassFlowSegment } from "@/components/ui/mass-flow-sankey";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type { AffectedStockPreview as Preview } from "@/types/output-stock";
import type { StockEntryKind } from "./output-stock-preview";

const PERCENT = 100;
/** Water below this is rounding noise, not a band worth drawing. */
const MIN_WATER_KG = 0.05;

/** The figures behind a re-estimating removal, all in kg, for the blocks and the flow. */
export interface ReestimateFigures {
  moisturePercent: number;
  binWetKg: number;
  binDryKg: number;
  removedWetKg: number;
  removedDryKg: number;
  stayWetKg: number;
  stayDryKg: number;
}

/** Null unless saving this movement re-estimates what stays and every figure is known. */
export function reestimateFigures(preview: Preview): ReestimateFigures | null {
  const { reestimate, beforeEstimatedWetKg, afterEstimatedWetKg, beforeDryKg, afterDryKg, removedWetKg, removedDryKg } = preview;
  if (!reestimate || preview.blockingMessage !== null) return null;
  if (beforeEstimatedWetKg === null || afterEstimatedWetKg === null || beforeDryKg === null || afterDryKg === null || removedWetKg === null || removedDryKg === null) return null;
  return {
    moisturePercent: reestimate.moisturePercent,
    binWetKg: beforeEstimatedWetKg, binDryKg: beforeDryKg,
    removedWetKg: Math.abs(removedWetKg), removedDryKg: Math.abs(removedDryKg),
    stayWetKg: afterEstimatedWetKg, stayDryKg: afterDryKg,
  };
}

/** True while the preview shows the re-estimate notice, so a form can leave the same advice off its own fields. */
export function showsReestimate(preview: Preview | null | undefined): boolean {
  return preview != null && reestimateFigures(preview) !== null;
}

/** Moisture of a wet figure that holds `dryKg` of dry biochar, as the percent the bin card shows. */
export function moistureOf(wetKg: number, dryKg: number): number {
  return wetKg > 0 ? ((wetKg - dryKg) / wetKg) * PERCENT : 0;
}

const REMOVED_NAME: Record<Exclude<StockEntryKind, "count">, string> = { loss: "Lost mass", delivery: "Delivery", correction: "Removed" };

function segments(parts: readonly MassFlowSegment[]): MassFlowSegment[] {
  return parts.filter((part) => part.kg >= MIN_WATER_KG);
}

/**
 * The mini flow: the bin's estimate (dry biochar that stays, dry biochar that
 * leaves, its water) into what stays and what leaves. The removal is wetter
 * than the estimate, so its water has to come from somewhere: the bin's own
 * water first, and the rest from a source of its own, "Water not in the
 * estimate", so the gap shows as mass the estimate never had.
 */
export function reestimateFlow(figures: ReestimateFigures, binName: string, kind: Exclude<StockEntryKind, "count">): MassFlowDiagram {
  const binWaterKg = Math.max(figures.binWetKg - figures.binDryKg, 0);
  const removedWaterKg = Math.max(figures.removedWetKg - figures.removedDryKg, 0);
  const stayWaterKg = Math.max(figures.stayWetKg - figures.stayDryKg, 0);
  const toRemovedKg = Math.min(binWaterKg, removedWaterKg);
  const toStayKg = Math.min(binWaterKg - toRemovedKg, stayWaterKg);
  const missingToRemovedKg = removedWaterKg - toRemovedKg;
  const missingToStayKg = stayWaterKg - toStayKg;
  const missingKg = missingToRemovedKg + missingToStayKg;
  const removedName = REMOVED_NAME[kind];
  const nodes: MassFlowDiagram["nodes"] = [
    { id: "bin", column: 0, name: binName, caption: `≈ ${formatMassKg(figures.binWetKg)} at ${formatMoisturePercent(moistureOf(figures.binWetKg, figures.binDryKg))}`, segments: segments([
      { id: "bin-dry-stays", kg: figures.stayDryKg, kind: "dry" },
      { id: "bin-dry-removed", kg: figures.removedDryKg, kind: "dry" },
      { id: "bin-water-removed", kg: toRemovedKg, kind: "water" },
      { id: "bin-water-stays", kg: toStayKg, kind: "water" },
    ]) },
    ...(missingKg >= MIN_WATER_KG ? [{ id: "missing", column: 0, name: "Water not in the estimate", caption: formatMassKg(missingKg), segments: segments([
      { id: "missing-stays", kg: missingToStayKg, kind: "water" },
      { id: "missing-removed", kg: missingToRemovedKg, kind: "water" },
    ]) }] : []),
    { id: "stays", column: 1, name: "Stays, re-estimated", caption: `≈ ${formatMassKg(figures.stayWetKg)} at ${formatMoisturePercent(figures.moisturePercent)}`, segments: segments([
      { id: "stays-dry", kg: figures.stayDryKg, kind: "dry" },
      { id: "stays-water", kg: toStayKg, kind: "water" },
      { id: "stays-water-missing", kg: missingToStayKg, kind: "water" },
    ]) },
    { id: "removed", column: 1, name: removedName, caption: `${formatMassKg(figures.removedWetKg)} at ${formatMoisturePercent(moistureOf(figures.removedWetKg, figures.removedDryKg))}`, segments: segments([
      { id: "removed-dry", kg: figures.removedDryKg, kind: "dry" },
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
