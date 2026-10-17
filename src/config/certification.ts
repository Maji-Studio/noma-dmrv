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
 * without an explicit choice. Not changeable in the UI. One source of truth for the connector UI, the certifier dialog,
 * and the data-access default.
 */
export const DEFAULT_PROTOCOL_SLUG = "biochar";
export const DEFAULT_PROTOCOL_LABEL = "Biochar";

/**
 * When certification status changes began to be recorded as activity events
 * (#1038, merged to staging 2026-10-15). Submission ledger rows created before
 * this have only their version timestamps, so their status history shows a
 * "Recording began on" note. A shipped fact rather than a per-organization
 * query: an organization's first recorded change can be later than this.
 */
export const CERTIFICATION_STATUS_RECORDING_STARTED_AT = "2026-10-15T13:40:53Z";
