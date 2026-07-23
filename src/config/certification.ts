/**
 * Client-safe certification constants.
 *
 * Lives in `@/config` (no server-only imports) so both client components
 * (e.g. the reactor form) and server data-access layers can share the same
 * canonical thresholds without pulling DB code into the client bundle.
 */

/**
 * Minimum number of prior Method A replicate samples a PRODUCTION PROCESS (the
 * (facility, feedstock) campaign) must accumulate for the Method-B
 * baseline (`G-F74T-0`). Counted per process since its
 * `established_at`, NOT per reactor (ADR 0022).
 */
export const METHOD_B_MINIMUM_METHOD_A_SAMPLES = 30;

/**
 * Protocol assigned when a facility ↔ registry project mapping is created
 * without an explicit choice. Changeable afterwards in Certification →
 * Settings. One source of truth for the connector UI, the certifier dialog,
 * and the data-access default.
 */
export const DEFAULT_PROTOCOL_SLUG = "biochar";
export const DEFAULT_PROTOCOL_LABEL = "Biochar";
