/** Ratios use numeric(7,6); compare their stored integer millionths. */
export const FORMULATION_RATIO_SCALE = 1_000_000;
export const FORMULATION_RATIO_STEP = 1 / FORMULATION_RATIO_SCALE;
export const RATIO_SUM_EXCEEDED_MESSAGE =
  "Biochar and ingredient ratios add up to more than 100% of the blend. Reduce them so the total is 100% or less.";

export function isExactFormulationRatio(ratio: number): boolean {
  return Math.round(ratio * FORMULATION_RATIO_SCALE) / FORMULATION_RATIO_SCALE === ratio;
}

export function exceedsFormulationRatioSum(
  biocharRatio: number | null | undefined,
  lines: ReadonlyArray<{ ratio?: number | null }> | null | undefined,
): boolean {
  const millionths = (ratio: number | null | undefined) => Math.round((ratio ?? 0) * FORMULATION_RATIO_SCALE);
  return millionths(biocharRatio) + (lines ?? []).reduce((sum, line) => sum + millionths(line.ratio), 0) > FORMULATION_RATIO_SCALE;
}
