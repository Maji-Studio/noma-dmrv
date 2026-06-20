/**
 * Method-B rolling-window compliance drift (ADR 0017 Track 2, item 7) — the two
 * protocol counters noma SURFACES + WARNS on, never auto-actions (D6). The
 * registry is the detector of record (it holds the raw samples per ADR 0013); a
 * new production process — which resets the baseline to Method A — is a
 * deliberate human action, never triggered here.
 *
 * ─── AUTHORITATIVE SOURCE (Biochar Protocol v1.3, "Frequency of Measurement") ──
 *   Within any 6-month window an Isometric review is triggered by EITHER:
 *     (1) ≥ 3 missed required samplings, OR
 *     (2) > 3 measurements below the 3σ lower bound (μ − 3σ).
 *   The 3σ bound itself only applies once ≥ 30 measurements exist
 *   (`WINSORISATION_MIN_MEASUREMENTS`), using the sample (n−1) std-dev.
 *
 * Pure and client-safe (no I/O), mirroring `sampling-requirements.ts`, so the
 * compliance UI and any server surface share one verdict. Non-authoritative
 * summary — verify against the protocol URL before relying on it for credit
 * claims.
 */

import {
  COMPLIANCE_MISSED_SAMPLINGS_TRIGGER,
  COMPLIANCE_SUB_3SIGMA_TRIGGER,
  THREE_SIGMA_MULTIPLIER,
  WINSORISATION_MIN_MEASUREMENTS,
} from "@/config/certification";
import { sampleMeanStdDev } from "@/lib/calculations/stats";
import {
  deriveSamplingRequirement,
  type BatchSampling,
  type SamplingMethod,
} from "./sampling-requirements";

export interface MissedSamplingsResult {
  /** Required samplings owed but not met across the window (cadence shortfall). */
  missedCount: number;
  /** Protocol review trigger: `>= trigger` missed in 6 mo → Isometric review. */
  trigger: number;
  /** True once `missedCount` reaches the trigger. */
  triggered: boolean;
  /** True when one short of the trigger (warn early). */
  approaching: boolean;
  totalBatches: number;
  sampledBatches: number;
  requiredSampledBatches: number;
}

/**
 * Count missed required samplings over a process's batches in the trailing
 * window. Reuses `deriveSamplingRequirement` (one cadence implementation): the
 * shortfall (`requiredSampledBatches − sampledBatches`) is what the process
 * still owes — i.e. what it has missed. Works for either method (Method A
 * requires every batch; Method B requires ⌈N/10⌉).
 */
export function countMissedSamplings(
  method: SamplingMethod,
  batchesInWindow: BatchSampling[],
): MissedSamplingsResult {
  const requirement = deriveSamplingRequirement(method, batchesInWindow);
  const missedCount = requirement.cadenceShortfall;
  return {
    missedCount,
    trigger: COMPLIANCE_MISSED_SAMPLINGS_TRIGGER,
    triggered: missedCount >= COMPLIANCE_MISSED_SAMPLINGS_TRIGGER,
    approaching: missedCount === COMPLIANCE_MISSED_SAMPLINGS_TRIGGER - 1,
    totalBatches: requirement.totalBatches,
    sampledBatches: requirement.sampledBatches,
    requiredSampledBatches: requirement.requiredSampledBatches,
  };
}

export interface SubThreeSigmaResult {
  /** Measurements below their leave-one-out 3σ lower bound in the window. */
  belowCount: number;
  /** Protocol review trigger: `> trigger` below 3σ in 6 mo → Isometric review. */
  trigger: number;
  /** True once `belowCount` exceeds the trigger (`> 3`). */
  triggered: boolean;
  /** True when AT the trigger (one more would breach). */
  approaching: boolean;
  /** Whole-pool mean (indicative, for display); null when no measurements. */
  mean: number | null;
  /** Whole-pool sample std-dev (indicative); null when < 2 measurements. */
  stdDev: number | null;
  /** Measurements in the window. */
  measurementCount: number;
  /** True once ≥ 30 measurements exist (the 3σ rule's precondition). */
  applies: boolean;
  /** Advisories (e.g. the rule not yet applying). */
  notes: string[];
}

/**
 * Count measurements below the 3σ lower bound (μ − 3σ) in the trailing window,
 * using the protocol's LEAVE-ONE-OUT μ/σ: each measurement is judged against the
 * mean + std-dev of the OTHER measurements, so a cluster of low outliers can't
 * inflate σ and mask itself (the failure mode a whole-pool bound has). The 3σ
 * rule only applies once ≥ 30 measurements exist; below that the count is 0 with
 * `applies=false` and a note (noma does not flag outliers on a thin pool — the
 * registry remains the authority).
 */
export function countSubThreeSigmaMeasurements(
  values: number[],
): SubThreeSigmaResult {
  const notes: string[] = [];
  const stats = sampleMeanStdDev(values);
  const measurementCount = stats?.count ?? 0;
  const applies = measurementCount >= WINSORISATION_MIN_MEASUREMENTS;

  const base = {
    trigger: COMPLIANCE_SUB_3SIGMA_TRIGGER,
    mean: stats?.mean ?? null,
    stdDev: stats?.stdDev ?? null,
    measurementCount,
  };

  if (!applies) {
    notes.push(
      `3σ outlier check needs ≥ ${WINSORISATION_MIN_MEASUREMENTS} measurements (have ${measurementCount}); not yet applied.`,
    );
    return {
      ...base,
      belowCount: 0,
      triggered: false,
      approaching: false,
      applies: false,
      notes,
    };
  }

  let belowCount = 0;
  for (let i = 0; i < values.length; i++) {
    const others = sampleMeanStdDev(values.filter((_, j) => j !== i));
    if (!others || others.stdDev == null) continue;
    const lowerBound = others.mean - THREE_SIGMA_MULTIPLIER * others.stdDev;
    if (values[i] < lowerBound) belowCount += 1;
  }

  return {
    ...base,
    belowCount,
    triggered: belowCount > COMPLIANCE_SUB_3SIGMA_TRIGGER,
    approaching: belowCount === COMPLIANCE_SUB_3SIGMA_TRIGGER,
    applies: true,
    notes,
  };
}

export interface ProcessComplianceDrift {
  missedSamplings: MissedSamplingsResult;
  subThreeSigma: SubThreeSigmaResult;
  /** True when EITHER counter has reached/exceeded its protocol trigger. */
  anyTriggered: boolean;
  /** True when EITHER counter is approaching its trigger (but none triggered). */
  anyApproaching: boolean;
}

/** Combine both counters into one process-level verdict for the compliance UI. */
export function evaluateProcessComplianceDrift(args: {
  method: SamplingMethod;
  batchesInWindow: BatchSampling[];
  carbonValuesInWindow: number[];
}): ProcessComplianceDrift {
  const missedSamplings = countMissedSamplings(
    args.method,
    args.batchesInWindow,
  );
  const subThreeSigma = countSubThreeSigmaMeasurements(
    args.carbonValuesInWindow,
  );
  const anyTriggered = missedSamplings.triggered || subThreeSigma.triggered;
  return {
    missedSamplings,
    subThreeSigma,
    anyTriggered,
    anyApproaching:
      !anyTriggered &&
      (missedSamplings.approaching || subThreeSigma.approaching),
  };
}
