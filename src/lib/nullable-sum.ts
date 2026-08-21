/**
 * Aggregation that keeps "nothing was reported" distinguishable from "the
 * reported total is zero".
 *
 * A displayed quantity must never be synthesized with `?? 0`: zero is a
 * measurement, absence is not, and a stat card reading "0 tph" claims a
 * reactor was measured at no throughput. Sum through `sumNullable` and hand the
 * `null` to a formatter, which renders the shared missing-value token (see the
 * missing-value rule in `@/lib/copy-utils`).
 *
 * Counts are the deliberate exception: zero rows is a true count, so keep
 * `?? 0` for `total`, `items.length`, and friends.
 */

/**
 * Sum the values that were actually reported. Returns `null` when none of them
 * was, so the caller can render a placeholder instead of a fabricated zero.
 * Non-finite entries (`NaN`, `Infinity`) count as unreported.
 */
export function sumNullable(
  values: Iterable<number | null | undefined>,
): number | null {
  let total = 0;
  let reported = false;

  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    total += value;
    reported = true;
  }

  return reported ? total : null;
}

/** `sumNullable` over a field of each item, for lists of records. */
export function sumNullableBy<T>(
  items: readonly T[],
  pick: (item: T) => number | null | undefined,
): number | null {
  return sumNullable(items.map(pick));
}
