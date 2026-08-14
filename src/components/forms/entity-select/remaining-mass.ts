import type { EntityOption } from "./types";
import { MISSING_VALUE } from "@/lib/copy-utils";

const KG_SUFFIX = "kg";

function formatWholeKg(kg: number | null): string {
  if (kg == null || !Number.isFinite(kg)) return MISSING_VALUE.notRecorded;
  return `${Math.round(kg).toLocaleString("en-US")}${KG_SUFFIX}`;
}

/** Exact operator copy for the selected option's always-visible stock caption. */
export function formatRemainingMass(
  remainingMass: NonNullable<EntityOption["remainingMass"]>,
  includeDryMass = true,
): string {
  const wet = `Remaining wet mass: ${formatWholeKg(remainingMass.wetKg)}`;
  if (!includeDryMass || !("dryKg" in remainingMass)) return wet;
  return `${wet} | dry mass: ${formatWholeKg(remainingMass.dryKg ?? null)}`;
}
