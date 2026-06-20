/**
 * Client-safe certification constants.
 *
 * Lives in `@/config` (no server-only imports) so both client components
 * (e.g. the reactor form) and server data-access layers can share the same
 * canonical thresholds without pulling DB code into the client bundle.
 */

/**
 * Minimum number of prior Method A replicate samples a PRODUCTION PROCESS (the
 * (facility, feedstock) campaign) must accumulate before it can switch its
 * sampling method to Method B (`G-F74T-0`). Counted per process since its
 * `established_at`, NOT per reactor — see `getMethodBEligibilityByProcess`.
 */
export const METHOD_B_MINIMUM_METHOD_A_SAMPLES = 30;

/**
 * Method B ongoing-sampling cadence: at least 1 sampled production batch per
 * this many production batches. A production batch IS a credit batch (ADR 0016),
 * NOT a production run. Biochar Protocol §8.3.1.2 (`G-2W0F-0`) — `>= 1/10`.
 * Required-sampled-batches is `ceil(totalBatches / cadence)`.
 */
export const METHOD_B_SAMPLING_CADENCE_BATCHES = 10;

// ── Method-B rolling-window compliance (ADR 0017 Track 2) ────────────────────
// All four are non-authoritative summaries of Biochar Protocol v1.3 ("Frequency
// of Measurement"), verified 2026-06-20; re-verify against the registry before
// relying on them for credit claims. noma SURFACES + WARNS only — the registry
// is the detector of record (it holds the raw samples per ADR 0013 / D6).

/**
 * Rolling window (months) for a production process's two protocol windows: the
 * eligible-sample pool that feeds the unsampled estimate (Eq 4) AND the
 * compliance-trigger window. The protocol uses one 6-month window for both.
 */
export const PROCESS_ROLLING_WINDOW_MONTHS = 6;

/**
 * Within a rolling 6-month window, this many missed required samplings triggers
 * an Isometric review (`>= 3`). noma warns as the count approaches it.
 */
export const COMPLIANCE_MISSED_SAMPLINGS_TRIGGER = 3;

/**
 * Within a rolling 6-month window, MORE than this many measurements below the 3σ
 * lower bound triggers an Isometric review (`> 3`, i.e. 4+).
 */
export const COMPLIANCE_SUB_3SIGMA_TRIGGER = 3;

/**
 * The 3σ winsorisation / outlier detection applies only once a process has
 * accumulated at least this many measurements (matches the Method-B baseline).
 */
export const WINSORISATION_MIN_MEASUREMENTS = 30;

/** Outlier-bound multiplier: a measurement is an outlier beyond `μ ± Nσ`. */
export const THREE_SIGMA_MULTIPLIER = 3;

/**
 * Protocol assigned when a facility ↔ registry project mapping is created
 * without an explicit choice. Changeable afterwards in Certification →
 * Settings. One source of truth for the connector UI, the certifier dialog,
 * and the data-access default.
 */
export const DEFAULT_PROTOCOL_SLUG = "biochar";
export const DEFAULT_PROTOCOL_LABEL = "Biochar";
