/**
 * Unit transforms between a noma source value and the unit a removal-template
 * input declares. A binding in the semantic binding catalog names the
 * transform it applies, so the transform travels with the binding (#638).
 */

export interface SourceTransform {
  apply: (value: number) => number;
  // Stable, declarative identity for `apply`. Function source text is not
  // stable across independently compiled Next.js bundles (a minifier may
  // rename the parameter), so MAPPING_REVISION hashes this value instead of
  // Function#toString. Bump it whenever transform semantics change.
  revision: string;
}

const PERCENT = 100;

export const IDENTITY = {
  apply: (value: number) => value,
  revision: "identity-v1",
} as const satisfies SourceTransform;

/** A 0-100 percent to the 0-1 fraction a dimensionless input expects. */
export const PERCENT_TO_FRACTION = {
  apply: (value: number) => value / PERCENT,
  revision: "percent-to-fraction-v1",
} as const satisfies SourceTransform;

/**
 * A dimensionless ratio to the `%` the 200-year `h_c_molar_ratios` input
 * declares. Unconfirmed against the sandbox; see
 * docs/open-questions-isometric.md.
 */
export const RATIO_TO_PERCENT = {
  apply: (value: number) => value * PERCENT,
  revision: "ratio-to-percent-v1",
} as const satisfies SourceTransform;
