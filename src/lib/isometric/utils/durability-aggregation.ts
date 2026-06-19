/**
 * Durability aggregation — the per-batch lists and conservative soil-temperature
 * estimate the 200-year sequestration blueprints consume (decisions D2, D5a).
 *
 * Unlike `aggregation.ts` (which collapses chemistry to mass-weighted scalars
 * for the legacy `carbon_rich_substance_sequestration` path), the registry's
 * `biochar_sequestration_200_year_{c_org,unsampled}` blueprints take PER-BATCH
 * LISTS — `h_c_molar_ratios`, `total_carbon_contents`, `inorganic_carbon_contents`,
 * `product_mass` — and mean / Winsorize them server-side themselves. So this
 * module emits one datapoint per production batch (run), each carrying the run's
 * replicate mean and sample std-dev, NOT a pre-collapsed scalar.
 *
 * ─── AUTHORITATIVE SOURCE (pinned, see docs/isometric/versions.json) ─────────
 *   Module "Biochar Storage in Soil Environments" v1.2 (CERTIFIED, tag 1.2.0)
 *   §5.1.1.2  C_biochar = Total Carbon − Inorganic Carbon (Eq.2).
 *   §5        Soil-temperature conservatism: if the within-boundary spread
 *             exceeds 1 °C, subdivide the project OR use the most conservative
 *             (highest) value. This implementation has only per-application
 *             soil temperatures and no project-area baseline, so it submits a
 *             CONSERVATIVE ESTIMATE — the max site temperature (7 °C floor) —
 *             surfaced as such (D2 soil-temp resolution).
 *
 * Non-authoritative summary — verify against the URL before relying on it.
 */

import type { Sample } from "@/db/schema";
import {
  SOIL_TEMPERATURE_FLOOR_C,
  SOIL_TEMPERATURE_SUBDIVIDE_SPREAD_C,
  roundSoilTemperatureC,
} from "@/lib/calculations/biochar-removal";
import { clampFactor, type ProductionRunWithSamples } from "./aggregation";

/**
 * Absolute divergence (dimensionless) between the operator-declared
 * `credit_batches.h_to_c_org_ratio` and the sample-aggregated value beyond which
 * a reconciliation warning is raised (D5a). The submitted figure is always the
 * sample-derived one; the declared field is advisory.
 */
export const H_TO_CORG_RECONCILIATION_TOLERANCE = 0.05;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isUsableNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

/** A replicate mean plus its sample (n−1) standard deviation. */
export interface ValueWithStdDev {
  mean: number;
  /** Sample standard deviation; null when fewer than 2 usable replicates. */
  stdDev: number | null;
}

function meanAndStdDev(values: number[]): ValueWithStdDev | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length < 2) return { mean, stdDev: null };
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, stdDev: Math.sqrt(variance) };
}

// Per-replicate inorganic carbon: prefer the measured value, else derive
// max(0, Total − Organic) via Eq.2 so the blueprint always has an inorganic
// figure without over-crediting (clamped non-negative).
function replicateInorganicCarbon(s: Sample): number | null {
  if (isUsableNumber(s.inorganicCarbonPercent)) return s.inorganicCarbonPercent;
  if (isUsableNumber(s.totalCarbonPercent) && isUsableNumber(s.organicCarbonPercent)) {
    return Math.max(0, s.totalCarbonPercent - s.organicCarbonPercent);
  }
  return null;
}

// ── Per-batch datapoint list (D2 revision — non-collapsed) ───────────────────

export interface PerBatchDurabilityDatapoint {
  productionRunId: string;
  productionRunCode: string;
  /** True when the run has at least one usable H/C_org replicate. */
  sampled: boolean;
  /** Replicate count backing the chemistry means (also feeds the ≥3 gate). */
  replicateCount: number;
  /** Molar H/C_org mean + std-dev across the run's replicates; null if unsampled. */
  hToCorgRatio: ValueWithStdDev | null;
  /** Total carbon % mean + std-dev; null if unsampled. */
  totalCarbonPercent: ValueWithStdDev | null;
  /** Inorganic carbon % mean + std-dev (measured or Eq.2-derived); null if unsampled. */
  inorganicCarbonPercent: ValueWithStdDev | null;
  /** Attribution-scaled biochar dry mass (kg) for this batch. */
  productMassKg: number;
}

/**
 * Build the per-batch durability datapoint list for a removal's runs. Each run
 * becomes one entry; chemistry is the run's replicate mean + std-dev. The
 * registry aggregates the lists itself (mean for `_c_org`, Winsorized mean ± SE
 * for `_unsampled`), so nothing is pre-collapsed here. `attributionByRunId`
 * scales each batch's product mass by the share of its biochar applied in this
 * removal (mirrors `aggregation.ts`; missing entry ⇒ fully attributed).
 */
export function buildPerBatchDurabilityData(
  runs: ProductionRunWithSamples[],
  attributionByRunId?: Map<string, number>,
): PerBatchDurabilityDatapoint[] {
  return runs.map((run) => {
    const factor = clampFactor(attributionByRunId?.get(run.id));
    const productMassKg = (run.biocharDryMassKg ?? 0) * factor;

    const hValues = run.samples
      .map((s) => s.hToCOrgRatio)
      .filter(isUsableNumber);
    const totalValues = run.samples
      .map((s) => s.totalCarbonPercent)
      .filter(isUsableNumber);
    const inorganicValues = run.samples
      .map(replicateInorganicCarbon)
      .filter(isUsableNumber);

    const hToCorgRatio = meanAndStdDev(hValues);

    return {
      productionRunId: run.id,
      productionRunCode: run.code,
      sampled: hToCorgRatio != null,
      replicateCount: hValues.length,
      hToCorgRatio,
      totalCarbonPercent: meanAndStdDev(totalValues),
      inorganicCarbonPercent: meanAndStdDev(inorganicValues),
      productMassKg,
    };
  });
}

// ── Conservative soil temperature (D2 soil-temp resolution) ──────────────────

export interface ConservativeSoilTemperature {
  /** Conservative estimate after the 7 °C floor + 1-dp rounding; null if no data. */
  effectiveSoilTemperatureC: number | null;
  /** Raw max across the removal's application sites before flooring; null if no data. */
  maxSoilTemperatureC: number | null;
  /** True when the raw max fell below 7 °C and was floored. */
  temperatureFloored: boolean;
  /** Site temperature spread (max − min); null when fewer than 1 usable site. */
  spreadC: number | null;
  /** True when sites span more than 1 °C (module §5 subdivide trigger). */
  subdivideWarning: boolean;
  /**
   * Always true — this is an explicit conservative approximation (site max), NOT
   * a measured project-area annual average. Surface it as such (Phase F badge +
   * Phase E datapoint description).
   */
  conservativeEstimate: boolean;
  /** Short method string recorded on the biochar_soil datapoint + shown in UI. */
  method: string;
  warnings: string[];
}

/**
 * Resolve the conservative soil-temperature estimate from the removal's
 * application-site temperatures: the MAX across sites (higher T_soil → lower
 * F_durable, the protocol's own worst-case rule, §5), with the 7 °C floor and a
 * subdivide advisory when sites span > 1 °C. This is a conservative
 * approximation in lieu of a project-area baseline — always flagged as such.
 */
export function resolveConservativeSoilTemperature(
  siteTemperaturesC: Array<number | null | undefined>,
): ConservativeSoilTemperature {
  const usable = siteTemperaturesC.filter(isUsableNumber);
  const method =
    `Conservative estimate: maximum soil temperature across ${usable.length} application site(s) ` +
    `(7 °C floor); not a measured project-area annual average.`;

  if (usable.length === 0) {
    return {
      effectiveSoilTemperatureC: null,
      maxSoilTemperatureC: null,
      temperatureFloored: false,
      spreadC: null,
      subdivideWarning: false,
      conservativeEstimate: true,
      method,
      warnings: [
        "No application site has a soil temperature — durability soil-temp input is indeterminate.",
      ],
    };
  }

  const maxSoilTemperatureC = Math.max(...usable);
  const minSoilTemperatureC = Math.min(...usable);
  const spreadC = maxSoilTemperatureC - minSoilTemperatureC;
  const subdivideWarning = spreadC > SOIL_TEMPERATURE_SUBDIVIDE_SPREAD_C;
  const temperatureFloored = maxSoilTemperatureC < SOIL_TEMPERATURE_FLOOR_C;
  const effectiveSoilTemperatureC = temperatureFloored
    ? SOIL_TEMPERATURE_FLOOR_C
    : roundSoilTemperatureC(maxSoilTemperatureC);

  const warnings: string[] = [];
  if (subdivideWarning) {
    warnings.push(
      `Application sites span ${spreadC.toFixed(1)} °C (> ${SOIL_TEMPERATURE_SUBDIVIDE_SPREAD_C} °C, module §5) — ` +
        `consider subdividing the project; the conservative max (${maxSoilTemperatureC.toFixed(1)} °C) is used.`,
    );
  }
  if (temperatureFloored) {
    warnings.push(`Soil temperature floored to ${SOIL_TEMPERATURE_FLOOR_C} °C (§5.1.1.3.1).`);
  }

  return {
    effectiveSoilTemperatureC,
    maxSoilTemperatureC,
    temperatureFloored,
    spreadC,
    subdivideWarning,
    conservativeEstimate: true,
    method,
    warnings,
  };
}

// ── Declared H/C reconciliation (D5a) ────────────────────────────────────────

/**
 * Reconcile the operator-declared `credit_batches.h_to_c_org_ratio` against the
 * sample-aggregated value. The submitted figure is ALWAYS the sample-derived
 * one; this only surfaces a divergence warning so the declared field can't
 * silently disagree with what's credited (mirrors the carbon reconciliation in
 * `resolveOrganicCarbonPercent`). Returns null when within tolerance or when
 * either value is missing.
 */
export function reconcileDeclaredHToCorg(
  declared: number | null | undefined,
  aggregated: number | null | undefined,
): string | null {
  if (!isUsableNumber(declared) || !isUsableNumber(aggregated)) return null;
  if (Math.abs(declared - aggregated) <= H_TO_CORG_RECONCILIATION_TOLERANCE) {
    return null;
  }
  return (
    `Declared H/C_org ${declared} diverges from the sample-aggregated ` +
    `${aggregated.toFixed(3)} (> ${H_TO_CORG_RECONCILIATION_TOLERANCE}). ` +
    `The sample-derived value is submitted; reconcile the declared field.`
  );
}
