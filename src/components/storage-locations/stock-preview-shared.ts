/**
 * Figures and wording the stock preview blocks share: the movement block, the
 * load block and the availability block read a bin the same way.
 */
import { formatCompositionMass, type MassSegment } from "@/components/forms/composition-ledger";
import { batchAccentFill } from "@/components/ui/segment-bar";
import type { AffectedStockPreview as Preview, OutputStockBalanceView } from "@/types/output-stock";

/**
 * The split bar divides a wet mass into dry solids and water, and dry solids are
 * not the tracked quantity: a blended product bin holding 84 kg of dry solids
 * holds 70 kg of dry biochar. Naming the segment "dry biochar" would put two
 * different masses under one label on the same block, so the bar says solids and
 * the balance pair keeps the tracked quantity.
 */
export const SPLIT_MATERIAL_LABEL = "Solids";

/**
 * Wet estimates are whole kilograms. They are computed at an entered moisture,
 * not weighed, so a decimal would claim a precision the figure does not have.
 */
const WET_ESTIMATE_DIGITS = 0;

/**
 * Batch layers as bar segments, each in its own accent.
 *
 * Every layer holds the same substance, so the `dry-batch` category cannot tell
 * two of them apart; the accent is what ties a segment to its key entry. Order
 * is the order the ledger returns, which is the order the draw consumed them.
 */
export function batchSegments(allocations: readonly OutputStockBalanceView[]): MassSegment[] {
  return allocations.map((allocation, index) => ({
    label: allocation.code,
    mass: allocation.dryMassKg,
    category: "dry-batch",
    fill: batchAccentFill(index),
  }));
}

/** Whole kilograms without the unit, for the muted before figure of a pair. */
/** Key figures under a wet headline: batches are tracked dry, so they say so. */
export function formatDryKeyMass(kg: number | null): string {
  return `${formatCompositionMass(kg)} dry`;
}

export function formatWetEstimate(kg: number): string {
  return kg.toLocaleString(undefined, { maximumFractionDigits: WET_ESTIMATE_DIGITS });
}

/**
 * The wet mass the split bar draws, or null when there is no split to draw.
 *
 * A removal carries the entered wet mass directly. A count does not: the planner
 * nulls `removedWetKg` for it and the counted mass reaches the preview as the
 * after wet estimate, which is the counted figure at the entered moisture. That
 * substitution only holds while the count is accepted in full, so a count that
 * exceeds tracked solids, or a preview whose balances were refused, keeps the
 * bar off rather than captioning a stale figure as an entry.
 *
 * A wet mass without moisture has no split either: the form's own moisture field
 * already carries that error, so an unresolved bar here would be a second copy.
 */
export function splitWetMassKg(preview: Preview): number | null {
  if (preview.movementMoisturePercent === null) return null;
  const counted = preview.blockingMessage === null && preview.discrepancySolidsKg <= 0
    ? preview.afterEstimatedWetKg
    : null;
  const entered = preview.removedWetKg === null ? counted : Math.abs(preview.removedWetKg);
  return entered !== null && entered > 0 ? entered : null;
}

/** Added or removed, from the sign the planner returns. */
export function movementDirection(massKg: number): string {
  return massKg < 0 ? "added" : "removed";
}

/** Sentence case: the quantity labels are stored lowercase for prose. */
export function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function binLabel(quantity: string): string {
  return capitalize(`${quantity} in bin`);
}

/**
 * A count that only changes moisture looks like a bug next to an unchanged
 * balance, so that one case gets a sentence, above the figures it explains.
 * Only an accepted count below the estimated wet stock reads as lost material:
 * a refused loss also arrives with nothing removed (its blocking message is the
 * sentence that applies), and without an estimate there is nothing to compare.
 */
export function dryingNotice(preview: Preview, enteredWetKg: number | null): string | null {
  const dryLabel = preview.dryLabel ?? "dry biochar";
  const acceptedCount = preview.removedWetKg === null && preview.blockingMessage === null;
  const estimate = preview.beforeEstimatedWetKg;
  const belowEstimate = enteredWetKg !== null && estimate !== null
    && Math.round(enteredWetKg) < Math.round(estimate);
  return acceptedCount && preview.removedDryKg === 0 && belowEstimate
    ? `Drying alone does not remove ${dryLabel}.`
    : null;
}

/** The definition the block cannot show as a number. Kept to one hint. */
export function stockCardHint(preview: Preview): string {
  if (preview.lane === "ingredient") {
    return "Wet stock is the recorded intake less tracked withdrawals. The moisture entered here describes this withdrawal only.";
  }
  return preview.removedDryKg === 0
    ? "Dry biochar is the tracked quantity, and drying alone does not change it. Wet stock is an estimate from each batch's latest moisture reading."
    : "Dry biochar is the tracked quantity. Wet stock is an estimate from each batch's latest moisture reading, and the reading entered here updates the batch it was taken from.";
}
