/**
 * Measurement-sample payload builder for the 200-year durability submission
 * (Phase E). Turns the per-batch durability aggregation (Phase D) into the
 * `CreateMeasurementSampleRequest` bodies the registry's
 * `biochar_sequestration_200_year_{c_org,unsampled}` blueprints consume:
 *
 *   - H/C_org  → a `biochar_production_batch` sample, property
 *     `{dimensionless_ratio, hydrogen_to_organic_carbon_ratio}`, per batch.
 *   - soil temp → a `biochar_soil` sample, property `{temperature}`, per project
 *     area (the conservative estimate from D2).
 *
 * The measurement properties, blueprint keys, and units below were confirmed by
 * the live coverage-check (plan §4, sandbox template rvt_1KS4S43VPSBXA26X).
 *
 * ─── ⚠️ SANDBOX-GATED — keep the live submit path behind these confirms ──────
 *   (1) The datapoint↔component-input BINDING (auto-link vs explicit
 *       `datapoint_id` reference) — not modelled here; resolved when wiring the
 *       live submit path against the sandbox.
 *   (2) The H/C ×100 UNIT TRANSFORM — the blueprint declares `h_c_molar_ratios`
 *       in `%`, but our samples store a dimensionless ratio (~0.5).
 *       `toHcMolarRatioPercent` applies ×100 as the most likely transform; this
 *       is UNCONFIRMED. See `docs/open-questions.md`.
 *
 * Carbon (`total_carbon_contents` / `inorganic_carbon_contents`) and
 * `product_mass` are blueprint inputs whose datapoint construction + binding are
 * part of the gated live wiring, not built here.
 *
 * Pure — no I/O. Client-safe except for the generated wire types.
 */

import type { components } from "../generated/certify";
import type { IsometricMeasurementProperty } from "../utils/measurement-property";
import type {
  ConservativeSoilTemperature,
  PerBatchDurabilityDatapoint,
} from "../utils/durability-aggregation";
import type { SamplingMethod } from "@/lib/certification/sampling-requirements";

type CreateMeasurementSampleRequest =
  components["schemas"]["CreateMeasurementSampleRequest"];
type CreateMeasurementSampleValueRequest =
  components["schemas"]["CreateMeasurementSampleValueRequest"];

// ── Confirmed constants (coverage-check, plan §4) ────────────────────────────

/** Molar H/C_org, grouped under the `biochar_production_batch` measurement type. */
export const H_TO_C_ORG_MEASUREMENT_PROPERTY: IsometricMeasurementProperty = {
  quantity_kind: "dimensionless_ratio",
  qualifier: "hydrogen_to_organic_carbon_ratio",
};

/** Soil temperature, grouped under the `biochar_soil` measurement type. */
export const SOIL_TEMPERATURE_MEASUREMENT_PROPERTY: IsometricMeasurementProperty =
  {
    quantity_kind: "temperature",
    qualifier: null,
  };

/** Sampled-batch sequestration blueprint (registry takes the mean of the list). */
export const SEQUESTRATION_BLUEPRINT_SAMPLED =
  "biochar_sequestration_200_year_c_org";

/** Unsampled-batch (Method B) blueprint (registry uses a Winsorized mean ± SE). */
export const SEQUESTRATION_BLUEPRINT_UNSAMPLED =
  "biochar_sequestration_200_year_unsampled";

/** Blueprint unit for `h_c_molar_ratios`. */
export const H_C_MOLAR_RATIO_UNIT = "%";

/** Blueprint unit for `soil_temp`. */
export const SOIL_TEMPERATURE_UNIT = "degC";

// ── ⚠️ Sandbox-gated H/C unit transform (confirm #2) ─────────────────────────

/**
 * The blueprint declares `h_c_molar_ratios` in `%`, but our samples store a
 * dimensionless molar ratio (~0.5). ×100 is the most likely transform but is
 * UNCONFIRMED against the sandbox — keep the live submit path behind this.
 */
export const H_C_MOLAR_RATIO_PERCENT_SCALE = 100;

export function toHcMolarRatioPercent(ratio: number): number {
  return ratio * H_C_MOLAR_RATIO_PERCENT_SCALE;
}

// ── D6 blueprint selection — the blueprint IS the Method A/B distinction ──────

/**
 * Select the sequestration blueprint for a batch: a lab-sampled batch submits to
 * the `_c_org` blueprint; an unsampled batch (only valid under Method B, where
 * the registry derives its carbon + durable fraction from historically sampled
 * batches) submits to `_unsampled` (D6).
 */
export function selectSequestrationBlueprintKey(args: {
  sampled: boolean;
  samplingMethod: SamplingMethod;
}): string {
  if (args.sampled) return SEQUESTRATION_BLUEPRINT_SAMPLED;
  // An unsampled batch is only valid under Method B (the registry derives its
  // carbon + durable fraction from sampled history). `{ sampled: false,
  // samplingMethod: "method_a" }` is an impossible state — the durability gates
  // require every Method A run to be sampled — so fail closed rather than route
  // it to the unsampled blueprint and mask an upstream gate regression.
  if (args.samplingMethod !== "method_b") {
    throw new Error(
      "selectSequestrationBlueprintKey: an unsampled batch is only valid under Method B",
    );
  }
  return SEQUESTRATION_BLUEPRINT_UNSAMPLED;
}

// ── Measurement-sample body builders ─────────────────────────────────────────

export interface BuildBiocharProductionBatchSampleArgs {
  batch: PerBatchDurabilityDatapoint;
  projectId: string;
  supplierRefId: string;
  /** ISO date-time the chemistry was measured/aggregated for. */
  measuredAt: string;
  /** Isometric production-batch id, when the run is already linked. */
  productionBatchId?: string | null;
}

/**
 * Build the `biochar_production_batch` measurement sample carrying the batch's
 * H/C_org value (mean + std-dev, ×100 to the blueprint's `%` unit). Returns null
 * for an unsampled batch — it has no chemistry to group (it submits via the
 * unsampled blueprint instead).
 */
export function buildBiocharProductionBatchSample(
  args: BuildBiocharProductionBatchSampleArgs,
): CreateMeasurementSampleRequest | null {
  const { batch, projectId, supplierRefId, measuredAt, productionBatchId } =
    args;
  if (!batch.sampled || !batch.hToCorgRatio) return null;

  const values: CreateMeasurementSampleValueRequest[] = [
    {
      measurement_property: H_TO_C_ORG_MEASUREMENT_PROPERTY,
      value: {
        magnitude: toHcMolarRatioPercent(batch.hToCorgRatio.mean),
        // Std-dev rides the same ×100 scale as the magnitude (same units).
        standard_deviation:
          batch.hToCorgRatio.stdDev != null
            ? toHcMolarRatioPercent(batch.hToCorgRatio.stdDev)
            : null,
        unit: H_C_MOLAR_RATIO_UNIT,
      },
    },
  ];

  return {
    feedstock_batch_id: null,
    measured_at: measuredAt,
    measurement_location_id: null,
    measurement_type: "biochar_production_batch",
    production_batch_id: productionBatchId ?? null,
    project_id: projectId,
    storage_location_id: null,
    supplier_reference_id: supplierRefId,
    values,
  };
}

export interface BuildBiocharSoilSampleArgs {
  soilTemp: ConservativeSoilTemperature;
  projectId: string;
  supplierRefId: string;
  measuredAt: string;
}

/**
 * Build the `biochar_soil` measurement sample carrying the conservative
 * soil-temperature estimate (D2). Returns null when the estimate is
 * indeterminate (no site had a soil temperature). The conservative-estimate
 * method string (`soilTemp.method`) is surfaced in the UI (Phase F) and recorded
 * on the underlying datapoint during the gated live wiring (the
 * `CreateMeasurementSampleRequest` body has no description field).
 */
export function buildBiocharSoilSample(
  args: BuildBiocharSoilSampleArgs,
): CreateMeasurementSampleRequest | null {
  const { soilTemp, projectId, supplierRefId, measuredAt } = args;
  if (soilTemp.effectiveSoilTemperatureC == null) return null;

  return {
    feedstock_batch_id: null,
    measured_at: measuredAt,
    measurement_location_id: null,
    measurement_type: "biochar_soil",
    production_batch_id: null,
    project_id: projectId,
    storage_location_id: null,
    supplier_reference_id: supplierRefId,
    values: [
      {
        measurement_property: SOIL_TEMPERATURE_MEASUREMENT_PROPERTY,
        value: {
          magnitude: soilTemp.effectiveSoilTemperatureC,
          standard_deviation: null,
          unit: SOIL_TEMPERATURE_UNIT,
        },
      },
    ],
  };
}
