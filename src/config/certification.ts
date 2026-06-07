/**
 * Client-safe certification constants.
 *
 * Lives in `@/config` (no server-only imports) so both client components
 * (e.g. the reactor form) and server data-access layers can share the same
 * canonical thresholds without pulling DB code into the client bundle.
 */

/**
 * Minimum number of prior Method A samples a reactor must have before it can
 * switch its sampling method to Method B.
 */
export const METHOD_B_MINIMUM_METHOD_A_SAMPLES = 30;
