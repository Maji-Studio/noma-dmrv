import type { EntityOption } from "./types";
import { MISSING_VALUE } from "@/lib/copy-utils";

function formatWholeKg(kg: number): string {
  return `${Math.round(kg).toLocaleString("en-US")} kg`;
}

function formatPart(kg: number | null, noun: string): string {
  if (kg == null || !Number.isFinite(kg)) {
    return `${noun} ${MISSING_VALUE.notRecorded.toLowerCase()}`;
  }
  return `${formatWholeKg(kg)} ${noun}`;
}

/**
 * Exact operator copy for the selected option's always-visible stock caption:
 * what is left now, before this record takes its share.
 */
export function formatRemainingMass(
  remainingMass: NonNullable<EntityOption["remainingMass"]>,
  includeDryMass = true,
): string {
  const lead =
    remainingMass.labelVariant === "excluding-this-order"
      ? "Remaining, excluding this order"
      : "Remaining now";
  const wet = formatPart(remainingMass.wetKg, "wet");
  if (!includeDryMass || !("dryKg" in remainingMass)) return `${lead}: ${wet}`;
  return `${lead}: ${wet}, ${formatPart(remainingMass.dryKg ?? null, "dry biochar")}`;
}
