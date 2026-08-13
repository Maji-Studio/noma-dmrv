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
 * ─── ⚠️ SANDBOX-GATED — keep the 200-year path behind this confirm ───────────
 *   The H/C ×100 UNIT TRANSFORM — the blueprint declares `h_c_molar_ratios`
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
import type { CreditBatchSampling } from "@/schemas/credit-batches";
import { CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS } from "@/schemas/samples";
import { SafeError } from "@/lib/errors";

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

/** Historical three-input component. Read/reconciliation only; never select it for a new template. */
export const DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR =
  "biochar_sequestration_1000_year";

/** Current sampled 1,000-year component with paired total/inorganic carbon lists. */
export const CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR =
  "biochar_sequestration_1000_year_f_durable_max";

/** Method-B 1,000-year component. Noma deliberately does not support this path. */
export const UNSAMPLED_SEQUESTRATION_BLUEPRINT_1000_YEAR =
  "biochar_sequestration_1000_year_unsampled";

export const SEQUESTRATION_1000_YEAR_COMPONENT_CONTRACTS = {
  deprecated: {
    blueprintKey: DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR,
    inputKeys: ["carbon_contents", "product_mass", "s_fraction"],
  },
  current: {
    blueprintKey: CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
    inputKeys: [
      "total_carbon_contents",
      "inorganic_carbon_contents",
      "s_fraction",
      "product_mass",
    ],
  },
} as const;

export type Sequestration1000YearComponentClassification =
  | "current"
  | "deprecated"
  | "unsupported-unsampled"
  | null;

export function classifySequestration1000YearComponent(
  blueprintKey: string,
): Sequestration1000YearComponentClassification {
  if (blueprintKey === CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR) {
    return "current";
  }
  if (blueprintKey === DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR) {
    return "deprecated";
  }
  if (blueprintKey === UNSAMPLED_SEQUESTRATION_BLUEPRINT_1000_YEAR) {
    return "unsupported-unsampled";
  }
  return null;
}

/**
 * Every sequestration blueprint key we recognise (200-year sampled + Method-B
 * unsampled, and 1000-year). These components are NOT fed by the legacy
 * aggregation→datapoint loop — `resolveTemplateInputs` and
 * `buildCreateGhgEntryRequest` skip them (see `isSequestrationBlueprintFamily`),
 * and the measurement-samples step carries their inputs instead. `submitRemoval`
 * uses this set to detect a durability template and apply the environment/path
 * availability gate.
 */
export const SEQUESTRATION_BLUEPRINT_KEYS: ReadonlySet<string> = new Set([
  SEQUESTRATION_BLUEPRINT_SAMPLED,
  SEQUESTRATION_BLUEPRINT_UNSAMPLED,
  CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
  DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR,
]);

export function isSequestrationBlueprintKey(blueprintKey: string): boolean {
  return SEQUESTRATION_BLUEPRINT_KEYS.has(blueprintKey);
}

/**
 * Prefix predicate recognising ANY biochar sequestration blueprint — including a
 * future/unknown variant we don't yet carry inputs for. `resolveTemplateInputs`
 * skips every sequestration component with this (not the datapoint loop, which
 * would throw a misleading missing-INPUT_MAPPING error); the submit-time
 * template↔tier guard then fails closed on any component NOT in the facility
 * tier's expected set (`expectedSequestrationBlueprintKeys`).
 */
export function isSequestrationBlueprintFamily(blueprintKey: string): boolean {
  return blueprintKey.startsWith("biochar_sequestration_");
}

/**
 * A facility's durability tier → the sequestration blueprint key(s) its Isometric
 * removal template must carry (ADR 0021). 200-year has two (lab-sampled +
 * Method-B unsampled); 1000-year has one. The submit-time guard rejects a
 * template whose sequestration component is outside this set for the facility
 * tier, with an actionable "re-author the template / change the tier" message.
 */
export function expectedSequestrationBlueprintKeys(
  tier: "200_year" | "1000_year",
): ReadonlySet<string> {
  return tier === "1000_year"
    ? new Set([CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR])
    : new Set([
        SEQUESTRATION_BLUEPRINT_SAMPLED,
        SEQUESTRATION_BLUEPRINT_UNSAMPLED,
      ]);
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
// these. The 200-year path remains fail-closed, so a wrong guess cannot reach a
// registry submission. One-constant edits per the plan.

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
  sampling: CreditBatchSampling;
}): string {
  return args.sampling === "sampled"
    ? SEQUESTRATION_BLUEPRINT_SAMPLED
    : SEQUESTRATION_BLUEPRINT_UNSAMPLED;
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
 * ─── ⚠️ UNVERIFIED WIRE FORMAT ────────────────────────────────────────────────
 * The exact `_unsampled` body — mass-only (this) vs. the registry deriving mass
 * from linked production batches — is UNCONFIRMED. The 200-year availability
 * gate keeps it inert, so a wrong guess cannot reach a registry submission. Resolve via
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

// ── 1000-year sequestration (ADR 0021) — ⚠️ SANDBOX-GATED wire binding ────────
//
// Built to the current `biochar_sequestration_1000_year_f_durable_max`
// component. It subtracts paired measured inorganic carbon from total carbon
// and caps the calculated durable fraction at 0.95. Each request represents one
// independently analysed Sample; product mass travels as one direct Datapoint.
//
// The explicit datapoint↔input binding is implemented in
// `sequestration-binding.ts` from the verified Certify response/component
// contract. The sandbox-only feature flag remains the operator kill-switch.

/** Total carbon content, dry basis — the current `total_carbon_contents` list input. */
export const TOTAL_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY: IsometricMeasurementProperty =
  {
    quantity_kind: "mass_fraction_dry_basis",
    qualifier: "total_carbon",
  };

/** Measured inorganic carbon, dry basis — the current `inorganic_carbon_contents` list input. */
export const INORGANIC_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY: IsometricMeasurementProperty =
  {
    quantity_kind: "mass_fraction_dry_basis",
    qualifier: "total_inorganic_carbon",
  };

/**
 * Per-sample `s_fraction` — the ISO 7404-5 inertinite fraction (proportion of
 * the sample's R₀ readings ≥ 2%). The 1000-year `s_fraction` list input.
 */
export const S_FRACTION_MEASUREMENT_PROPERTY: IsometricMeasurementProperty = {
  // Confirmed against the Isometric sandbox measurement-sample validator.
  // The value remains a 0–1 fraction in a dimensionless unit.
  quantity_kind: "dimensionless_ratio",
  qualifier: "inertinite_fraction",
};

/** Blueprint unit for both current dry-basis carbon-content lists. */
export const CARBON_CONTENTS_1000_YEAR_UNIT = "dimensionless";

/** Blueprint unit for `s_fraction` (a 0–1 proportion). */
export const S_FRACTION_UNIT = "dimensionless";

/** One current-component replicate: three measurements from the same Sample row. */
export interface Sequestration1000YearReplicate {
  /** Total carbon, dry basis, as a 0–1 mass fraction. */
  totalCarbonContentFraction: number;
  /** Directly measured inorganic carbon, dry basis, as a 0–1 mass fraction. */
  inorganicCarbonContentFraction: number;
  /** Proportion (0–1) of this sample's R₀ readings ≥ 2% (s_fraction). */
  sFraction: number;
}

export interface Build1000YearSequestrationSampleArgs {
  replicate: Sequestration1000YearReplicate;
  projectId: string;
  supplierRefId: string;
  measuredAt: string;
  productionBatchId?: string | null;
}

/**
 * Build the `biochar_production_batch` measurement sample carrying the 1000-year
 * inputs as evidence: paired total carbon, measured inorganic carbon, and
 * `s_fraction` values from one local Sample. Carbon response datapoints bind
 * their GHG inputs. Product mass is deliberately not a property of the physical
 * Sample. The sample's
 * `dimensionless_ratio` s_fraction values remain data-quality evidence while
 * the orchestrator posts matching `dimensionless` datapoints for that LIST
 * input. Pure — no I/O. ⚠️ Sandbox-gated (see header).
 */
export function build1000YearSequestrationSample(
  args: Build1000YearSequestrationSampleArgs,
): CreateMeasurementSampleRequest {
  const { replicate } = args;
  assert1000YearReplicate(replicate);
  const values: CreateMeasurementSampleValueRequest[] = [
    {
      measurement_property:
        TOTAL_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
      value: {
        magnitude: replicate.totalCarbonContentFraction,
        standard_deviation: null,
        unit: CARBON_CONTENTS_1000_YEAR_UNIT,
      },
    },
    {
      measurement_property:
        INORGANIC_CARBON_CONTENTS_1000_YEAR_MEASUREMENT_PROPERTY,
      value: {
        magnitude: replicate.inorganicCarbonContentFraction,
        standard_deviation: null,
        unit: CARBON_CONTENTS_1000_YEAR_UNIT,
      },
    },
    {
      measurement_property: S_FRACTION_MEASUREMENT_PROPERTY,
      value: {
        magnitude: replicate.sFraction,
        standard_deviation: null,
        unit: S_FRACTION_UNIT,
      },
    },
  ];

  return {
    feedstock_batch_id: null,
    measured_at: args.measuredAt,
    measurement_location_id: null,
    measurement_type: "biochar_production_batch",
    production_batch_id: args.productionBatchId ?? null,
    project_id: args.projectId,
    storage_location_id: null,
    supplier_reference_id: args.supplierRefId,
    values,
  };
}

const MINIMUM_1000_YEAR_REPLICATES = 3;
const FRACTION_MIN = 0;
const FRACTION_MAX = 1;
const CARBON_RECONCILIATION_TOLERANCE_FRACTION =
  CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS / 100;

function assertFraction(value: number, label: string): void {
  if (!Number.isFinite(value) || value < FRACTION_MIN || value > FRACTION_MAX) {
    throw new SafeError(`${label} must be a number from 0 to 1.`);
  }
}

function assert1000YearReplicate(
  replicate: Sequestration1000YearReplicate,
): void {
  assertFraction(replicate.totalCarbonContentFraction, "Total carbon");
  assertFraction(replicate.inorganicCarbonContentFraction, "Inorganic carbon");
  assertFraction(replicate.sFraction, "R₀ fraction");
  if (
    replicate.inorganicCarbonContentFraction -
      replicate.totalCarbonContentFraction >
    CARBON_RECONCILIATION_TOLERANCE_FRACTION
  ) {
    throw new SafeError(
      `Inorganic carbon cannot exceed total carbon by more than ${CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS} percentage points.`,
    );
  }
}

/** Final wire-boundary assertion for the replacement component's paired lists. */
export function assert1000YearInputListInvariants(args: {
  totalCarbonContents: number[];
  inorganicCarbonContents: number[];
  sFractions: number[];
}): void {
  const lengths = [
    args.totalCarbonContents.length,
    args.inorganicCarbonContents.length,
    args.sFractions.length,
  ];
  if (new Set(lengths).size !== 1) {
    throw new SafeError(
      "The 1,000-year total-carbon, inorganic-carbon, and R₀ lists must have equal lengths.",
    );
  }
  if (lengths[0] < MINIMUM_1000_YEAR_REPLICATES) {
    throw new SafeError(
      `A 1,000-year Removal requires at least ${MINIMUM_1000_YEAR_REPLICATES} complete replicates.`,
    );
  }
  for (let index = 0; index < lengths[0]; index += 1) {
    const total = args.totalCarbonContents[index];
    const inorganic = args.inorganicCarbonContents[index];
    const sFraction = args.sFractions[index];
    assertFraction(total, `Total carbon replicate ${index + 1}`);
    assertFraction(inorganic, `Inorganic carbon replicate ${index + 1}`);
    assertFraction(sFraction, `R₀ fraction replicate ${index + 1}`);
    if (inorganic - total > CARBON_RECONCILIATION_TOLERANCE_FRACTION) {
      throw new SafeError(
        `Inorganic carbon replicate ${index + 1} cannot exceed total carbon by more than ${CARBON_RECONCILIATION_TOLERANCE_PERCENTAGE_POINTS} percentage points.`,
      );
    }
  }
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
