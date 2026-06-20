/**
 * Measurement-sample payload builder for the 200-year durability submission
 * (Phase E). Turns the per-batch durability aggregation (Phase D) into the
 * `CreateMeasurementSampleRequest` bodies the registry's
 * `biochar_sequestration_200_year_{c_org,unsampled}` blueprints consume:
 *
 *   - H/C_org + total/inorganic carbon + product mass → a
 *     `biochar_production_batch` sample (one value per blueprint list input),
 *     per credit batch.
 *   - soil temp → a `biochar_soil` sample, property `{temperature}`, the
 *     facility's operator-declared reference value (Phase 2 / ADR 0013).
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
  FacilityReferenceSoilTemperature,
  PerBatchDurabilityDatapoint,
  ValueWithStdDev,
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

/**
 * The two sequestration blueprint keys (sampled + unsampled). These components
 * are NOT fed by the legacy aggregation→datapoint loop — `resolveTemplateInputs`
 * and `buildCreateGhgEntryRequest` skip them, and the measurement-samples step
 * carries their inputs instead. `submitRemoval` uses this set to detect a
 * durability template and gate it behind `DURABILITY_MEASUREMENT_SAMPLES_LIVE`.
 */
export const SEQUESTRATION_BLUEPRINT_KEYS: ReadonlySet<string> = new Set([
  SEQUESTRATION_BLUEPRINT_SAMPLED,
  SEQUESTRATION_BLUEPRINT_UNSAMPLED,
]);

export function isSequestrationBlueprintKey(blueprintKey: string): boolean {
  return SEQUESTRATION_BLUEPRINT_KEYS.has(blueprintKey);
}

/** Blueprint unit for `h_c_molar_ratios`. */
export const H_C_MOLAR_RATIO_UNIT = "%";

/** Blueprint unit for `soil_temp`. */
export const SOIL_TEMPERATURE_UNIT = "degC";

// ── Carbon + product-mass measurement properties (⚠️ sandbox-gated) ───────────
//
// The `biochar_production_batch` measurement also carries the batch's total /
// inorganic carbon content and product mass — the registry's
// `biochar_sequestration_200_year_c_org` blueprint lists `total_carbon_contents`,
// `inorganic_carbon_contents` and `product_mass` alongside `h_c_molar_ratios`.
// The measurement properties, units, and the carbon %→fraction scale below are
// the most likely shapes but are UNCONFIRMED — the same coverage-check that
// pins the H/C unit (`pnpm isometric:coverage-check -- --source=db`) reports
// these. They are inert until `DURABILITY_MEASUREMENT_SAMPLES_LIVE` flips, so a
// wrong guess can never reach a live credit. One-constant edits per the plan.

/** Total carbon content, grouped under `biochar_production_batch`. */
export const TOTAL_CARBON_MEASUREMENT_PROPERTY: IsometricMeasurementProperty = {
  quantity_kind: "mass_fraction",
  qualifier: "total_carbon",
};

/** Inorganic carbon content, grouped under `biochar_production_batch`. */
export const INORGANIC_CARBON_MEASUREMENT_PROPERTY: IsometricMeasurementProperty =
  {
    quantity_kind: "mass_fraction",
    qualifier: "total_inorganic_carbon",
  };

/** Batch product mass (kg), grouped under `biochar_production_batch`. */
export const PRODUCT_MASS_MEASUREMENT_PROPERTY: IsometricMeasurementProperty = {
  quantity_kind: "mass",
  qualifier: null,
};

/** Blueprint unit for `total_carbon_contents` / `inorganic_carbon_contents`. */
export const CARBON_CONTENT_UNIT = "dimensionless";

/** Blueprint unit for `product_mass`. */
export const PRODUCT_MASS_UNIT = "kg";

/**
 * Carbon content arrives as a percent (0–100) on the aggregation; the blueprint
 * input is a 0–1 mass fraction (mirrors the legacy `carbon_content /100`
 * transform). ⚠️ Sandbox-gated — confirm the declared unit before the live flip.
 */
export const CARBON_CONTENT_FRACTION_SCALE = 1 / 100;

export function toCarbonContentFraction(percent: number): number {
  return percent * CARBON_CONTENT_FRACTION_SCALE;
}

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
      `selectSequestrationBlueprintKey: an unsampled batch is only valid under Method B ` +
        `(sampled=${args.sampled}, samplingMethod=${args.samplingMethod}). ` +
        `Verify upstream durability gate evaluation before submission.`,
    );
  }
  return SEQUESTRATION_BLUEPRINT_UNSAMPLED;
}

// ── Measurement-sample body builders ─────────────────────────────────────────

// A %→fraction carbon-content value: magnitude + std-dev both scaled, same unit.
function carbonContentValue(
  property: IsometricMeasurementProperty,
  content: ValueWithStdDev,
): CreateMeasurementSampleValueRequest {
  return {
    measurement_property: property,
    value: {
      magnitude: toCarbonContentFraction(content.mean),
      standard_deviation:
        content.stdDev != null ? toCarbonContentFraction(content.stdDev) : null,
      unit: CARBON_CONTENT_UNIT,
    },
  };
}

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
 * chemistry + product mass: H/C_org (mean + std-dev, ×100 to the blueprint's `%`
 * unit), total / inorganic carbon content (mean + std-dev, %→fraction), and the
 * attribution-scaled product mass (kg). Each value yields one datapoint the
 * registry binds to the matching `biochar_sequestration_200_year_c_org` list
 * input. Returns null for an unsampled batch — it has no chemistry to group (it
 * submits via the unsampled blueprint instead). Carbon values are omitted when
 * the batch pooled no usable replicate for them (the H/C value always anchors a
 * sampled batch).
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

  // Total / inorganic carbon content — %→fraction (⚠️ sandbox-gated scale).
  if (batch.totalCarbonPercent) {
    values.push(
      carbonContentValue(
        TOTAL_CARBON_MEASUREMENT_PROPERTY,
        batch.totalCarbonPercent,
      ),
    );
  }
  if (batch.inorganicCarbonPercent) {
    values.push(
      carbonContentValue(
        INORGANIC_CARBON_MEASUREMENT_PROPERTY,
        batch.inorganicCarbonPercent,
      ),
    );
  }

  // Product mass (kg) — a single per-batch magnitude, no std-dev.
  values.push({
    measurement_property: PRODUCT_MASS_MEASUREMENT_PROPERTY,
    value: {
      magnitude: batch.productMassKg,
      standard_deviation: null,
      unit: PRODUCT_MASS_UNIT,
    },
  });

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

/**
 * Build the `biochar_production_batch` measurement sample for an UNSAMPLED
 * Method-B batch — the `_unsampled` blueprint route (D8). The batch carries no
 * chemistry of its own; the registry derives its conservative carbon + durable
 * fraction (Eq 4/5 + 3σ winsorisation) from the process's historically sampled
 * batches. So this body carries ONLY the batch's attribution-scaled product mass
 * (the quantity the registry multiplies its derived figure by).
 *
 * ─── ⚠️ SANDBOX-GATED WIRE FORMAT (confirm before the live flip) ──────────────
 * The exact `_unsampled` body — mass-only (this) vs. the registry deriving mass
 * from linked production batches — is UNCONFIRMED. It is inert until
 * `DURABILITY_MEASUREMENT_SAMPLES_LIVE` flips (the whole step is gated), so a
 * wrong guess can never reach a live credit. Resolve via
 * `pnpm isometric:coverage-check -- --source=db` with the sequestration template,
 * then tune here. See `docs/open-questions.md`.
 *
 * Pure — no I/O. The caller asserts the batch is genuinely unsampled AND on
 * Method B (via `selectSequestrationBlueprintKey`) before invoking this.
 */
export function buildBiocharUnsampledBatchSample(args: {
  batch: PerBatchDurabilityDatapoint;
  projectId: string;
  supplierRefId: string;
  measuredAt: string;
  productionBatchId?: string | null;
}): CreateMeasurementSampleRequest {
  const { batch, projectId, supplierRefId, measuredAt, productionBatchId } =
    args;
  return {
    feedstock_batch_id: null,
    measured_at: measuredAt,
    measurement_location_id: null,
    measurement_type: "biochar_production_batch",
    production_batch_id: productionBatchId ?? null,
    project_id: projectId,
    storage_location_id: null,
    supplier_reference_id: supplierRefId,
    values: [
      {
        measurement_property: PRODUCT_MASS_MEASUREMENT_PROPERTY,
        value: {
          magnitude: batch.productMassKg,
          standard_deviation: null,
          unit: PRODUCT_MASS_UNIT,
        },
      },
    ],
  };
}

export interface BuildBiocharSoilSampleArgs {
  /**
   * The facility's operator-declared reference soil temperature (Phase 2):
   * `effectiveSoilTemperatureC` is already 7 °C-floored + one-decimal, so this
   * builder submits it verbatim. The PDD-bound `method`/`source` strings carry
   * the justification for the UI + evidence ledger (the API body has no
   * description field), not the wire payload.
   */
  soilTemp: FacilityReferenceSoilTemperature;
  projectId: string;
  supplierRefId: string;
  measuredAt: string;
}

/**
 * Build the `biochar_soil` measurement sample carrying the facility reference
 * soil temperature (Phase 2 / ADR 0013). The caller has already resolved the
 * reference (and a 200-year removal fails closed via a durability gate blocker
 * when it is unset), so this takes a non-null `FacilityReferenceSoilTemperature`
 * and always returns a sample.
 */
export function buildBiocharSoilSample(
  args: BuildBiocharSoilSampleArgs,
): CreateMeasurementSampleRequest {
  const { soilTemp, projectId, supplierRefId, measuredAt } = args;

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
