import type { EntityOption } from "./types";

const KG_SUFFIX = "kg";
const UNKNOWN_MASS = "Not recorded";

function formatWholeKg(kg: number | null): string {
  if (kg == null || !Number.isFinite(kg)) return UNKNOWN_MASS;
  return `${Math.round(kg).toLocaleString("en-US")}${KG_SUFFIX}`;
}

/** Exact operator copy for the selected option's always-visible stock caption. */
export function formatRemainingMass(
  remainingMass: NonNullable<EntityOption["remainingMass"]>,
): string {
  const wet = `Remaining wet mass: ${formatWholeKg(remainingMass.wetKg)}`;
  if (!("dryKg" in remainingMass)) return wet;
  return `${wet} | dry mass: ${formatWholeKg(remainingMass.dryKg ?? null)}`;
}
