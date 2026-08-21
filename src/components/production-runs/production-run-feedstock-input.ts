/**
 * The "Total wet input" recap under the feedstock draw rows.
 *
 * Picking a bin is not the same as weighing it. The recap used to coalesce
 * un-entered row masses to 0 and render "Total wet input 0 kg from 1 bin" the
 * moment a bin was chosen, which is a measurement claim the run has not made.
 * The total stays null until at least one row carries a mass, and the recap
 * then shows the missing-value token without the "from n bins" suffix, plus one
 * line naming the input the operator still has to fill.
 */
import { formatCount, MISSING_VALUE } from "@/lib/copy-utils";
import { formatMassKg } from "@/lib/format-utils";
import { sumNullable } from "@/lib/nullable-sum";

/** Follow-up line shown only while the total is unknown. */
export const FEEDSTOCK_WET_INPUT_HINT =
  "Enter a wet mass for each selected bin.";

export interface FeedstockDrawLike {
  storageLocationId?: string | null;
  wetMassKg?: unknown;
}

export interface FeedstockWetInputSummary {
  /** Σ of the masses actually entered. Null when no row carries one. */
  totalWetMassKg: number | null;
  /** Rows that have picked a bin. */
  binCount: number;
  /** Whether the recap belongs on screen at all. */
  visible: boolean;
  /** The recap's headline line. */
  valueText: string;
  /** Follow-up line naming the missing input, or null when the total is known. */
  hintText: string | null;
}

export function summarizeFeedstockWetInput(
  draws: readonly (FeedstockDrawLike | null | undefined)[],
): FeedstockWetInputSummary {
  const totalWetMassKg = sumNullable(
    draws.map((draw) =>
      typeof draw?.wetMassKg === "number" ? draw.wetMassKg : null,
    ),
  );
  const binCount = draws.filter((draw) => !!draw?.storageLocationId).length;
  const isMissing = totalWetMassKg === null;

  return {
    totalWetMassKg,
    binCount,
    visible: binCount > 0 || !isMissing,
    valueText: isMissing
      ? MISSING_VALUE.notRecorded
      : `${formatMassKg(totalWetMassKg)} from ${formatCount(binCount, "bin")}`,
    hintText: isMissing ? FEEDSTOCK_WET_INPUT_HINT : null,
  };
}
