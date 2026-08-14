import { MISSING_VALUE } from "@/lib/copy-utils";
import { sumNullableBy } from "@/lib/nullable-sum";

/** Reactor throughput is quoted in tonnes per hour on every surface. */
export const THROUGHPUT_UNIT = "tph";

interface ThroughputSource {
  nominalThroughputTph: number | null;
}

/**
 * Combined nominal throughput for a page of reactors.
 *
 * `nominalThroughputTph` is nullable and the reactor detail sheet already reads
 * "Not recorded" for it, so the stat card must not answer "0 tph" for the same
 * datum. When no reactor on the page reports a figure the card shows the token
 * and drops the unit with it.
 */
export function formatTotalThroughputTph(
  reactors: readonly ThroughputSource[],
): string {
  const total = sumNullableBy(reactors, (r) => r.nominalThroughputTph);
  if (total === null) return MISSING_VALUE.notRecorded;
  return `${total.toLocaleString()} ${THROUGHPUT_UNIT}`;
}
