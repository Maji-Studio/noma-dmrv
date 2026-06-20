/**
 * Pure sample-statistics helpers shared by the Method-B local preview and the
 * compliance-drift engines (ADR 0017 Track 2). The protocol's Eq 4/5 and the 3σ
 * window all use the SAMPLE (n−1) standard deviation, so one implementation
 * backs them both (drift control).
 *
 * Mirrors the private `meanAndStdDev` in
 * `src/lib/isometric/utils/durability-aggregation.ts` — that copy can converge
 * onto this helper once its server-coupled neighbours (`./aggregation`) are
 * untangled from the client-safe path. Tracked in `docs/open-questions.md`
 * (`certification/method-b-compute-cleanups`). Client-safe — no I/O.
 */

export interface SampleStats {
  /** Arithmetic mean of the values. */
  mean: number;
  /** Sample (n−1) standard deviation; null when fewer than 2 values. */
  stdDev: number | null;
  /** Count of values. */
  count: number;
}

/**
 * Mean + sample (n−1) standard deviation of a numeric set. Returns null for an
 * empty set; `stdDev` is null for a single value (n−1 = 0 is undefined).
 */
export function sampleMeanStdDev(values: number[]): SampleStats | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, stdDev: null, count: values.length };
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, stdDev: Math.sqrt(variance), count: values.length };
}
