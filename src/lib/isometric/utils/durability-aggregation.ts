/**
 * Durability aggregation — the per-batch lists and conservative soil-temperature
 * estimate the 200-year sequestration blueprints consume (decisions D2, D5a).
 *
 * Grain (ADR 0016): the protocol production batch IS the credit batch, so this
 * module aggregates at the CREDIT-BATCH grain — one datapoint per credit batch,
 * pooling that batch's lab Samples across its member production runs/days into a
 * single replicate mean + sample std-dev. A Sample is entered against a run for
 * provenance, but its >=3-replicate characterisation is a property of the batch
 * (§8.3.1), never of one run.
 *
 * Unlike `aggregation.ts` (which collapses chemistry to mass-weighted scalars
 * for the legacy `carbon_rich_substance_sequestration` path), the registry's
 * `biochar_sequestration_200_year_{c_org,unsampled}` blueprints take PER-BATCH
 * LISTS — `h_c_molar_ratios`, `total_carbon_contents`, `inorganic_carbon_contents`,
 * `product_mass` — and mean / Winsorize them server-side themselves. So this
 * module emits one datapoint per credit batch, each carrying the batch's pooled
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
import { clampFactor } from "./aggregation";

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

// ── Per-batch datapoint list (credit-batch grain, ADR 0016) ──────────────────

/** A member production run of a credit batch — the unit product mass sums over. */
export interface DurabilityBatchRun {
  id: string;
  biocharDryMassKg: number | null;
}

/**
 * A credit batch's durability inputs: its pooled lab Samples (keyed on
 * `samples.creditBatchId`, across member runs/days) plus the member runs whose
 * biochar dry mass composes the batch. Pure shape — the DB loader
 * (`getCreditBatchesWithSamples`) returns a structurally-compatible superset.
 */
export interface CreditBatchDurabilityInput {
  creditBatchId: string;
  creditBatchCode: string;
  /** Lab Samples pooled by `samples.creditBatchId`, across member runs/days. */
  samples: Sample[];
  /** Member production runs (id + dry mass) the product-mass sum ranges over. */
  runs: DurabilityBatchRun[];
}

export interface PerBatchDurabilityDatapoint {
  creditBatchId: string;
  creditBatchCode: string;
  /** True when the batch pools at least one usable H/C_org replicate. */
  sampled: boolean;
  /** Replicate count backing the chemistry means (also feeds the ≥3 gate). */
  replicateCount: number;
  /** Molar H/C_org mean + std-dev across the batch's pooled replicates; null if unsampled. */
  hToCorgRatio: ValueWithStdDev | null;
  /** Total carbon % mean + std-dev; null if unsampled. */
  totalCarbonPercent: ValueWithStdDev | null;
  /** Inorganic carbon % mean + std-dev (measured or Eq.2-derived); null if unsampled. */
  inorganicCarbonPercent: ValueWithStdDev | null;
  /** Attribution-scaled biochar dry mass (kg) summed across the batch's member runs. */
  productMassKg: number;
}

/**
 * Build the per-batch durability datapoint list for a removal's credit batches.
 * Each batch becomes one entry; chemistry is the batch's POOLED replicate mean +
 * std-dev (all member runs' Samples merged — the protocol characterises the
 * batch, not the run). The registry aggregates the per-batch lists itself (mean
 * for `_c_org`, Winsorized mean ± SE for `_unsampled`), so nothing is
 * pre-collapsed here. `attributionByRunId` scales each member run's biochar dry
 * mass by the share applied in this removal (mirrors `aggregation.ts`; a missing
 * entry ⇒ fully attributed — the context passes only the removal's applied runs).
 */
export function buildPerBatchDurabilityData(
  batches: CreditBatchDurabilityInput[],
  attributionByRunId?: Map<string, number>,
): PerBatchDurabilityDatapoint[] {
  return batches.map((batch) => {
    const productMassKg = batch.runs.reduce(
      (sum, run) =>
        sum +
        (run.biocharDryMassKg ?? 0) * clampFactor(attributionByRunId?.get(run.id)),
      0,
    );

    const hValues = batch.samples
      .map((s) => s.hToCOrgRatio)
      .filter(isUsableNumber);
    const totalValues = batch.samples
      .map((s) => s.totalCarbonPercent)
      .filter(isUsableNumber);
    const inorganicValues = batch.samples
      .map(replicateInorganicCarbon)
      .filter(isUsableNumber);

    const hToCorgRatio = meanAndStdDev(hValues);

    return {
      creditBatchId: batch.creditBatchId,
      creditBatchCode: batch.creditBatchCode,
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

// ── Facility reference soil temperature (ADR 0013 / soil module §5.1.1.3.1) ───

/**
 * The operator-declared facility-level reference soil temperature submitted to
 * the registry as the `biochar_soil` measurement for a 200-year removal. Unlike
 * `resolveConservativeSoilTemperature` (a site-max approximation derived from
 * per-application values), this is the AUTHORITATIVE annual-average value the
 * operator sources from an approved global dataset and justifies in the PDD.
 */
export interface FacilityReferenceSoilTemperature {
  /** Declared value, one decimal (pre-floor) — what the operator entered. */
  declaredSoilTemperatureC: number;
  /** The value submitted to the registry: declared, 7 °C-floored, one decimal. */
  effectiveSoilTemperatureC: number;
  /** Dataset / region citation recorded for the PDD audit trail, or null. */
  source: string | null;
  /** True when the declared value was below the 7 °C floor and was raised to it. */
  temperatureFloored: boolean;
  /** Short method string recorded alongside the datapoint + shown in the UI. */
  method: string;
  /** Floor advisory(s) — non-blocking. */
  warnings: string[];
}

/**
 * Resolve the facility's declared reference soil temperature into the value
 * submitted to the registry: round to one decimal and apply the 7 °C floor
 * (§5.1.1.3.1). Returns null when the facility has no declared value — the
 * caller decides whether that is fail-closed (it is, for a 200-year removal that
 * has credit batches to submit) or simply "not yet configured".
 */
export function resolveFacilityReferenceSoilTemperature(input: {
  declaredSoilTemperatureC: number | null | undefined;
  source: string | null | undefined;
}): FacilityReferenceSoilTemperature | null {
  if (!isUsableNumber(input.declaredSoilTemperatureC)) return null;

  const declaredSoilTemperatureC = roundSoilTemperatureC(
    input.declaredSoilTemperatureC,
  );
  const temperatureFloored =
    input.declaredSoilTemperatureC < SOIL_TEMPERATURE_FLOOR_C;
  const effectiveSoilTemperatureC = temperatureFloored
    ? SOIL_TEMPERATURE_FLOOR_C
    : declaredSoilTemperatureC;
  const source = input.source?.trim() ? input.source.trim() : null;

  const warnings: string[] = [];
  if (temperatureFloored) {
    warnings.push(`Soil temperature floored to ${SOIL_TEMPERATURE_FLOOR_C} °C (§5.1.1.3.1).`);
  }

  return {
    declaredSoilTemperatureC,
    effectiveSoilTemperatureC,
    source,
    temperatureFloored,
    method:
      `Facility reference soil temperature (annual average; 7 °C floor)` +
      (source ? ` — ${source}` : ""),
    warnings,
  };
}

/**
 * Conservative-direction reconciliation between the declared facility reference
 * and the removal's member-application site temperatures. Higher T_soil → lower
 * F_durable, so an application site WARMER than the declared reference means the
 * reference would over-credit that site's durability. That is the only direction
 * worth warning about (a cooler site is conservative and fine). Advisory — joins
 * the non-blocking submission warnings; the submitted value is always the
 * facility reference (the per-application override is a future ADR).
 */
export function buildSoilTemperatureReconciliationWarnings(args: {
  facilityReference: FacilityReferenceSoilTemperature;
  applicationSoilTemperaturesC: Array<number | null | undefined>;
}): string[] {
  const usable = args.applicationSoilTemperaturesC.filter(isUsableNumber);
  if (usable.length === 0) return [];

  const maxSiteC = Math.max(...usable);
  if (maxSiteC <= args.facilityReference.effectiveSoilTemperatureC) return [];

  return [
    `An application site soil temperature (${maxSiteC.toFixed(1)} °C) exceeds the declared ` +
      `facility reference (${args.facilityReference.effectiveSoilTemperatureC.toFixed(1)} °C) — ` +
      `the reference may over-credit durability for that site. Reconcile the facility ` +
      `reference value (admin → Emission estimates) or its PDD justification.`,
  ];
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
