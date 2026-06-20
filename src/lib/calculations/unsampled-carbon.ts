/**
 * Local, NON-AUTHORITATIVE preview of an unsampled Method-B batch's conservative
 * organic-carbon estimate (ADR 0017 Track 2, item 6). Mirrors the role of
 * `computeFDurable200`: noma previews; THE REGISTRY computes the credited number
 * (ADR 0013 / D1). Never submitted.
 *
 * ─── AUTHORITATIVE SOURCE (pinned, see docs/isometric/versions.json) ──────────
 *   Module "Biochar Storage in Soil Environments" v1.2 (CERTIFIED, tag 1.2.0)
 *   Eq.4  §5.1.1   C_biochar = μ_CC − σ_CC/√n   (conservative organic-carbon est.)
 *   Eq.5  §5.1.1   σ_CC̄      = σ_CC / √n         (standard error)
 *
 * The pool is the production process's ELIGIBLE samples — those taken in the
 * trailing 6 months before the batch, from the same process (CONTEXT.md
 * "Eligible sample"). The estimate is the eligible-sample mean MINUS one standard
 * error (a conservative haircut). The registry additionally applies 3σ
 * winsorisation over the eligible pool; this preview does NOT winsorise — outlier
 * drift is surfaced separately (compliance-drift, item 7). Advisory only.
 *
 * Non-authoritative summary — verify against the protocol URL before relying on
 * it for credit claims. Pure, client-safe — no I/O.
 */

import { PROCESS_ROLLING_WINDOW_MONTHS } from "@/config/certification";
import { sampleMeanStdDev } from "./stats";

/**
 * Trailing window (months) that makes a process sample "eligible" (the Eq 4
 * pool). The protocol's single 6-month rolling window — shared with the
 * compliance counters via `PROCESS_ROLLING_WINDOW_MONTHS`.
 */
export const ELIGIBLE_SAMPLE_WINDOW_MONTHS = PROCESS_ROLLING_WINDOW_MONTHS;

/** One candidate sample for the eligible pool. */
export interface EligibleSampleDatum {
  /** Organic carbon content C_biochar (%, dry basis) — the CC in Eq 4. */
  organicCarbonPercent: number | null | undefined;
  /** When the sample was taken (drives the trailing-window filter). */
  samplingTime: Date;
  /** The credit batch the sample characterises (for leave-one-out). */
  creditBatchId: string | null;
}

export interface EligibleWindowOptions {
  /** Estimate "as of" the unsampled batch's production date. */
  asOfDate: Date;
  /**
   * Leave-one-out: drop samples from this batch (the one being estimated). An
   * unsampled batch carries none, but excluding it keeps the estimate
   * independent of the batch when previewing a borderline sampled one.
   */
  excludeCreditBatchId?: string | null;
  /** Trailing window (months). Defaults to `ELIGIBLE_SAMPLE_WINDOW_MONTHS`. */
  windowMonths?: number;
}

export interface UnsampledCarbonPreview {
  /** Conservative estimate C = μ − σ/√n (%, dry basis); null when not computable. */
  estimateOrganicCarbonPercent: number | null;
  /** Eligible-pool mean organic carbon (%); null when the pool is empty. */
  meanOrganicCarbonPercent: number | null;
  /** Eligible-pool sample std-dev (%); null when < 2 eligible samples. */
  stdDevOrganicCarbonPercent: number | null;
  /** Standard error σ/√n (Eq 5); null when < 2 eligible samples. */
  standardError: number | null;
  /** Eligible samples actually used (freshness). */
  eligibleSampleCount: number;
  /** Trailing window (months) the pool was drawn from (freshness). */
  windowMonths: number;
  /** Always false — a local preview, not the credited number (D1). */
  authoritative: false;
  /** Why a value is missing / advisories about the pool. */
  notes: string[];
}

/**
 * The trailing-window start for an as-of date: `asOfDate − windowMonths`. THE
 * single definition of where the 6-month eligible/compliance window begins —
 * shared by `filterEligibleSamples` (sample pool) and the process compliance-
 * drift batch window, so the window boundary lives in exactly one place.
 */
export function eligibleWindowCutoff(
  asOfDate: Date,
  windowMonths: number = ELIGIBLE_SAMPLE_WINDOW_MONTHS,
): Date {
  const cutoff = new Date(asOfDate);
  cutoff.setMonth(cutoff.getMonth() - windowMonths);
  return cutoff;
}

/**
 * Whether a date falls in the half-open trailing window `[cutoff, asOfDate)`.
 * THE single definition of the window boundary rule (exclusive upper) — applied
 * to sample `samplingTime` here and to credit-batch production dates in the
 * compliance-drift read path, so samples and batches can't drift to different
 * boundary conventions.
 */
export function isWithinEligibleWindow(
  when: Date,
  asOfDate: Date,
  cutoff: Date,
): boolean {
  return when >= cutoff && when < asOfDate;
}

/**
 * The eligible samples for a batch: those in the trailing window before
 * `asOfDate`, same process, minus the excluded (leave-one-out) batch. Pure date
 * filter — does not look at chemistry (the preview drops carbon-less rows).
 */
export function filterEligibleSamples(
  samples: EligibleSampleDatum[],
  options: EligibleWindowOptions,
): EligibleSampleDatum[] {
  const windowMonths = options.windowMonths ?? ELIGIBLE_SAMPLE_WINDOW_MONTHS;
  const cutoff = eligibleWindowCutoff(options.asOfDate, windowMonths);

  return samples.filter((s) => {
    if (
      options.excludeCreditBatchId != null &&
      s.creditBatchId === options.excludeCreditBatchId
    ) {
      return false;
    }
    // "Previous 6 months BEFORE the batch": within [cutoff, asOfDate).
    return isWithinEligibleWindow(s.samplingTime, options.asOfDate, cutoff);
  });
}

function emptyPreview(
  windowMonths: number,
  meanOrganicCarbonPercent: number | null,
  eligibleSampleCount: number,
  notes: string[],
): UnsampledCarbonPreview {
  return {
    estimateOrganicCarbonPercent: null,
    meanOrganicCarbonPercent,
    stdDevOrganicCarbonPercent: null,
    standardError: null,
    eligibleSampleCount,
    windowMonths,
    authoritative: false,
    notes,
  };
}

/**
 * Preview the conservative organic-carbon estimate (Eq 4/5) for an unsampled
 * batch over its process's eligible pool. Returns a structured, auditable result;
 * a missing value is explained in `notes`. Always non-authoritative.
 */
export function previewUnsampledCarbon(
  samples: EligibleSampleDatum[],
  options: EligibleWindowOptions,
): UnsampledCarbonPreview {
  const windowMonths = options.windowMonths ?? ELIGIBLE_SAMPLE_WINDOW_MONTHS;
  const eligible = filterEligibleSamples(samples, options);

  const values = eligible
    .map((s) => s.organicCarbonPercent)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const notes: string[] = [];
  const droppedForCarbon = eligible.length - values.length;
  if (droppedForCarbon > 0) {
    notes.push(
      `${droppedForCarbon} eligible sample(s) excluded — missing organic-carbon chemistry.`,
    );
  }

  const stats = sampleMeanStdDev(values);
  if (!stats) {
    notes.push(
      `No eligible samples in the trailing ${windowMonths} months — cannot preview an unsampled estimate.`,
    );
    return emptyPreview(windowMonths, null, 0, notes);
  }
  if (stats.stdDev == null) {
    notes.push(
      "Only 1 eligible sample — a standard error needs ≥ 2; showing the mean without a conservative margin.",
    );
    return emptyPreview(windowMonths, stats.mean, stats.count, notes);
  }

  const standardError = stats.stdDev / Math.sqrt(stats.count);
  return {
    estimateOrganicCarbonPercent: stats.mean - standardError,
    meanOrganicCarbonPercent: stats.mean,
    stdDevOrganicCarbonPercent: stats.stdDev,
    standardError,
    eligibleSampleCount: stats.count,
    windowMonths,
    authoritative: false,
    notes,
  };
}
