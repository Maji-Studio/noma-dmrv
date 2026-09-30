import { PERCENT_SCALE } from "@/lib/mass-moisture";

/** Smallest share of the row a resolved bar is drawn at, so a tiny output stays visible. */
const MIN_FLOW_BAR_PERCENT = 6;

/** The mass that fills the row: the heavier of the run's two wet masses. */
export function flowScaleKg(
  feedstockKg: number | null | undefined,
  biocharKg: number | null | undefined,
): number {
  return Math.max(feedstockKg ?? 0, biocharKg ?? 0);
}

/**
 * Width of a split bar as a share of its row, drawn to the run's shared mass
 * scale. Undefined (full row) when the mass or the scale is unknown. The form's
 * process flow and the read sheet both use this so they cannot drift.
 */
export function flowBarWidthPercent(
  massKg: number | null | undefined,
  scaleKg: number,
): number | undefined {
  if (massKg == null || !(scaleKg > 0)) return undefined;
  return Math.max((massKg / scaleKg) * PERCENT_SCALE, MIN_FLOW_BAR_PERCENT);
}
