import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import type { ProductionRun, Sample, TransportLeg } from "@/db/schema";

export type ProductionRunWithSamples = ProductionRun & {
  samples: Sample[];
  readingsCount?: number;
};

export interface AggregatedProductionData {
  weightedOrganicCarbonPercent: number | null;
  weightedHToCorgRatio: number | null;
  weightedOToCorgRatio: number | null;
  weightedAshPercent: number | null;
  weightedMoisturePercent: number | null;
  totalBiocharDryMassKg: number;
  totalFeedstockDryMassKg: number;
  // Diesel split by use: startup/plant diesel feeds the volume-based
  // Certify component; genset diesel feeds the energy-based genset
  // components (converted to kWh via the facility's genset yield).
  totalStartupDieselLitres: number;
  totalGensetDieselLitres: number;
  totalElectricityKwh: number;
  // Mass-weighted distance per transport-leg category, such that Certify's
  // server-side `distance × Σmass × factor` equals Σⱼ(distⱼ × massⱼ × factor)
  // — compliant with Isometric Transportation v1.1 §5 when every leg in the
  // category shares the same method + emission factor. Mixed categories
  // surface a warning instead of a value (see `aggregateTransportLegs`).
  // Null when no legs are recorded OR when uniformity could not be
  // established. Caller populates via `enrichWithTransportLegs`.
  feedstockTransportAvgDistanceKm: number | null;
  biocharTransportAvgDistanceKm: number | null;
  sampleTransportAvgDistanceKm: number | null;
  // Total sample-shipment mass-distance (tonne·km) — Σ(distance × load
  // mass) over the sample legs. 0 when no sample legs (a valid value:
  // no sample transport). Populated by `enrichWithTransportLegs`.
  sampleTransportMassDistanceTonneKm: number;
  // Per-process-stage energy, populated by `enrichWithFacilityConfig`
  // from the combined per-run totals + the facility's stage-split
  // estimate. Null until enriched.
  biomassElectricityKwh: number | null;
  pyrolysisElectricityKwh: number | null;
  biocharElectricityKwh: number | null;
  biomassGensetKwh: number | null;
  pyrolysisGensetKwh: number | null;
  biocharGensetKwh: number | null;
  earliestStartTime: Date;
  latestEndTime: Date;
  sourceProductionRunIds: string[];
  warnings: string[];
}

// Aggregates a category's transport legs into a single mass-weighted distance
// such that Certify's `distance × Σmass × factor` server-side calculation
// equals the per-leg sum Σⱼ(distⱼ × massⱼ × factor) — compliant with Isometric
// Transportation v1.1 §5. The emission factor is NOT stored on our legs: it
// lives in the Isometric component blueprint, so collapsing is valid only when
// every leg shares the local fields that select that factor.
//
// Returns:
//   { distanceKm }                  — mass-weighted distance
//   { warning }                     — missing load mass, mixed method, or empty
export interface TransportAggregationResult {
  distanceKm: number | null;
  warning: string | null;
}

// Percent-to-fraction denominator.
const PERCENT_DENOMINATOR = 100;

const TRANSPORT_FACTOR_FIELDS = [
  "calculationMethodType",
  "transportMethodType",
  "vehicleType",
  "modelYear",
] as const satisfies readonly (keyof TransportLeg)[];
type TransportFactorField = (typeof TRANSPORT_FACTOR_FIELDS)[number];

function formatFactorValue(value: TransportLeg[TransportFactorField]): string {
  return value == null ? "unset" : String(value);
}

function getMixedTransportFactorWarning(
  legs: TransportLeg[],
  categoryLabel: string,
): string | null {
  if (legs.length === 0) return null;

  const first = legs[0];
  for (const leg of legs) {
    for (const field of TRANSPORT_FACTOR_FIELDS) {
      if (leg[field] !== first[field]) {
        return (
          `${categoryLabel} transport legs mix factor fields ` +
          `(${field}: ${formatFactorValue(first[field])} vs ${formatFactorValue(leg[field])}); ` +
          "submit separately or unify transport method and vehicle fields."
        );
      }
    }
  }

  return null;
}

export function aggregateTransportLegs(
  legs: TransportLeg[],
  categoryLabel: string,
): TransportAggregationResult {
  if (legs.length === 0) {
    return { distanceKm: null, warning: null };
  }

  // Every leg needs a load mass to mass-weight the distance. Unweighted means
  // are non-compliant (they would silently underweight large loads).
  const missingMassLegIds = legs
    .filter((leg) => leg.loadMassKg == null || leg.loadMassKg <= 0)
    .map((leg) => leg.id);
  if (missingMassLegIds.length > 0) {
    return {
      distanceKm: null,
      warning: `${categoryLabel} transport legs missing load_mass_kg (${missingMassLegIds.join(", ")}) - required for per-leg accounting`,
    };
  }

  const factorWarning = getMixedTransportFactorWarning(legs, categoryLabel);
  if (factorWarning) {
    return {
      distanceKm: null,
      warning: factorWarning,
    };
  }

  let weighted = 0;
  let weightSum = 0;
  for (const leg of legs) {
    const mass = leg.loadMassKg as number;
    weighted += leg.distanceKm * mass;
    weightSum += mass;
  }
  return { distanceKm: weighted / weightSum, warning: null };
}

// Clamps a per-run attribution factor into [0, 1]. A removal can only count
// the share of a run's biochar that actually got applied. A missing entry
// (no attribution map, or run absent from it) defaults to 1.0 — the run is
// fully attributed. A non-finite value signals corrupt data and fails safe
// to 0 (the run is excluded) rather than silently counting the whole run.
function clampFactor(value: number | null | undefined): number {
  if (value == null) return 1;
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// `attributionByRunId` carries the applied-biochar fraction for each run —
// appliedDryKgFromThisRemoval / runTotalBiocharOutput. A run only partially
// applied within this removal contributes proportionally (linear mass
// allocation, equivalent to an Isometric attribution factor). Omitted or a
// missing entry defaults to 1.0 (the run is fully attributed).
export function aggregateProductionRuns(
  runs: ProductionRunWithSamples[],
  attributionByRunId?: Map<string, number>,
): AggregatedProductionData {
  if (runs.length === 0) {
    throw new Error("aggregateProductionRuns: no production runs supplied");
  }

  const warnings: string[] = [];
  const sourceProductionRunIds = runs.map((r) => r.id);

  let totalBiocharDryMassKg = 0;
  let totalFeedstockDryMassKg = 0;
  let totalStartupDieselLitres = 0;
  let totalGensetDieselLitres = 0;
  let totalElectricityKwh = 0;
  let earliestStartTime = runs[0].startTime;
  let latestEndTime = runs[0].endTime;

  for (const run of runs) {
    const factor = clampFactor(attributionByRunId?.get(run.id));
    totalBiocharDryMassKg += nz(run.biocharDryMassKg) * factor;
    totalFeedstockDryMassKg += nz(run.feedstockMassDryKg) * factor;
    totalStartupDieselLitres +=
      (nz(run.dieselOperationLiters) + nz(run.preprocessingFuelLiters)) *
      factor;
    totalGensetDieselLitres += nz(run.dieselGensetLiters) * factor;
    totalElectricityKwh += nz(run.electricityKwh) * factor;
    if (run.startTime < earliestStartTime) earliestStartTime = run.startTime;
    if (run.endTime > latestEndTime) latestEndTime = run.endTime;

    if (run.biocharDryMassKg == null) {
      warnings.push(`Run ${run.code}: missing biocharDryMassKg`);
    }
    if (run.samples.length === 0) {
      warnings.push(`Run ${run.code}: no samples`);
    }
  }

  return {
    weightedOrganicCarbonPercent: weightedAverage(
      runs,
      (s) => s.organicCarbonPercent,
      attributionByRunId,
    ),
    weightedHToCorgRatio: weightedAverage(
      runs,
      (s) => s.hToCOrgRatio,
      attributionByRunId,
    ),
    weightedOToCorgRatio: weightedAverage(
      runs,
      (s) => s.oToCOrgRatio,
      attributionByRunId,
    ),
    weightedAshPercent: weightedAverage(
      runs,
      (s) => s.ashContentPercent,
      attributionByRunId,
    ),
    weightedMoisturePercent: weightedAverage(
      runs,
      (s) => s.moistureContentPercent,
      attributionByRunId,
    ),
    totalBiocharDryMassKg,
    totalFeedstockDryMassKg,
    totalStartupDieselLitres,
    totalGensetDieselLitres,
    totalElectricityKwh,
    // Transport + per-stage fields default to null. Caller enriches via
    // `enrichWithTransportLegs` and `enrichWithFacilityConfig`.
    feedstockTransportAvgDistanceKm: null,
    biocharTransportAvgDistanceKm: null,
    sampleTransportAvgDistanceKm: null,
    sampleTransportMassDistanceTonneKm: 0,
    biomassElectricityKwh: null,
    pyrolysisElectricityKwh: null,
    biocharElectricityKwh: null,
    biomassGensetKwh: null,
    pyrolysisGensetKwh: null,
    biocharGensetKwh: null,
    earliestStartTime,
    latestEndTime,
    sourceProductionRunIds,
    warnings,
  };
}

export interface TransportLegsByCategory {
  feedstock: TransportLeg[];
  biochar: TransportLeg[];
  sample: TransportLeg[];
}

// Layers transport-leg distances onto an existing aggregation result.
// Pure: returns a new object, doesn't mutate `agg`. Per-category warnings
// (mixed methods/factors, missing per-leg data) are appended to
// `agg.warnings`, which the submission pipeline short-circuits on.
export function enrichWithTransportLegs(
  agg: AggregatedProductionData,
  legs: TransportLegsByCategory,
): AggregatedProductionData {
  const feedstock = aggregateTransportLegs(legs.feedstock, "Feedstock");
  const biochar = aggregateTransportLegs(legs.biochar, "Biochar");
  const sample = aggregateTransportLegs(legs.sample, "Sample");
  const newWarnings = [
    feedstock.warning,
    biochar.warning,
    sample.warning,
  ].filter((w): w is string => w !== null);

  return {
    ...agg,
    feedstockTransportAvgDistanceKm: feedstock.distanceKm,
    biocharTransportAvgDistanceKm: biochar.distanceKm,
    sampleTransportAvgDistanceKm: sample.distanceKm,
    sampleTransportMassDistanceTonneKm: sumMassDistanceTonneKm(legs.sample),
    warnings: [...agg.warnings, ...newWarnings],
  };
}

// Σ(distance_km × load_mass_tonnes) over the legs — the `mass_distance`
// quantity (tonne·km) the Certify `mass_distance_based_ci_emissions`
// blueprint expects. 0 for an empty category (no sample transport).
function sumMassDistanceTonneKm(legs: TransportLeg[]): number {
  if (getMixedTransportFactorWarning(legs, "Sample")) return 0;

  let total = 0;
  for (const leg of legs) {
    total += leg.distanceKm * kgToTonnes(nz(leg.loadMassKg));
  }
  return total;
}

// Per-facility emission-estimate config — the four columns added to
// `certifier_projects` in Phase 3.7. All required (the submission path
// validates non-null before calling `enrichWithFacilityConfig`).
export interface FacilityEmissionConfig {
  gensetEnergyYieldKwhPerLitre: number;
  stageSplitBiomassPct: number;
  stageSplitPyrolysisPct: number;
  stageSplitBiocharPct: number;
}

// Layers per-process-stage energy onto an aggregation result. Pure;
// returns a new object. Splits the combined per-run electricity and
// genset energy across biomass / pyrolysis / biochar by the facility's
// estimated stage ratios. The split is emissions-neutral (all three
// stages share one carbon intensity in the template) — it only shapes
// the per-stage breakdown shown in the registry. Genset litres are
// converted to kWh via the facility's genset yield.
export function enrichWithFacilityConfig(
  agg: AggregatedProductionData,
  config: FacilityEmissionConfig,
): AggregatedProductionData {
  const electricity = agg.totalElectricityKwh;
  const gensetKwh =
    agg.totalGensetDieselLitres * config.gensetEnergyYieldKwhPerLitre;
  const biomass = config.stageSplitBiomassPct / PERCENT_DENOMINATOR;
  const pyrolysis = config.stageSplitPyrolysisPct / PERCENT_DENOMINATOR;
  const biochar = config.stageSplitBiocharPct / PERCENT_DENOMINATOR;

  return {
    ...agg,
    biomassElectricityKwh: electricity * biomass,
    pyrolysisElectricityKwh: electricity * pyrolysis,
    biocharElectricityKwh: electricity * biochar,
    biomassGensetKwh: gensetKwh * biomass,
    pyrolysisGensetKwh: gensetKwh * pyrolysis,
    biocharGensetKwh: gensetKwh * biochar,
  };
}

// Mass-weighted by the applied share of run.biocharDryMassKg using the
// per-run mean of `pick` across that run's samples — so the carbon content
// reflects the biochar that actually got applied. Runs with no usable
// samples, zero mass, or a zero attribution factor are dropped from both
// numerator and denominator.
function weightedAverage(
  runs: ProductionRunWithSamples[],
  pick: (s: Sample) => number | null,
  attributionByRunId?: Map<string, number>,
): number | null {
  let weightSum = 0;
  let weighted = 0;
  for (const run of runs) {
    const factor = clampFactor(attributionByRunId?.get(run.id));
    const mass = run.biocharDryMassKg;
    if (mass == null || mass <= 0 || factor <= 0) continue;
    const values = run.samples
      .map(pick)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (values.length === 0) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const weight = mass * factor;
    weighted += mean * weight;
    weightSum += weight;
  }
  return weightSum === 0 ? null : weighted / weightSum;
}

function nz(value: number | null | undefined): number {
  return value == null ? 0 : value;
}

export interface ResolvedTemplateInput {
  groupKey: string;
  removalTemplateComponentId: string;
  componentBlueprintKey: string;
  inputKey: string;
  type: "fixed" | "monitored";
  preboundDatapointId: string | null;
}

export interface MissingInput {
  groupKey: string;
  removalTemplateComponentId: string;
  inputKey: string;
  reason: string;
}

// Three-level nested INPUT_MAPPING shape passed in by the caller. Decouples
// this utility from the concrete `transformers/datapoint.ts` import.
type NestedInputMapping = Record<
  string,
  Record<
    string,
    Record<string, { source: keyof AggregatedProductionData }>
  >
>;

// Walks the resolved template's monitored inputs (delegated by caller) and
// reports which can't be served by `agg`. INPUT_MAPPING covers the link from
// (group, blueprint, input) → AggregatedProductionData field; this function
// checks both presence in the mapping and a non-null source value.
export function validateForTemplate(
  agg: AggregatedProductionData,
  monitoredInputs: ResolvedTemplateInput[],
  inputMapping: NestedInputMapping,
): { ok: true } | { ok: false; missing: MissingInput[] } {
  const missing: MissingInput[] = [];
  for (const input of monitoredInputs) {
    if (input.type !== "monitored") continue;
    const map =
      inputMapping[input.groupKey]?.[input.componentBlueprintKey]?.[
        input.inputKey
      ];
    if (!map) {
      missing.push({
        groupKey: input.groupKey,
        removalTemplateComponentId: input.removalTemplateComponentId,
        inputKey: input.inputKey,
        reason: `No INPUT_MAPPING entry for group="${input.groupKey}" blueprint="${input.componentBlueprintKey}" input="${input.inputKey}"`,
      });
      continue;
    }
    const value = agg[map.source];
    if (value == null) {
      missing.push({
        groupKey: input.groupKey,
        removalTemplateComponentId: input.removalTemplateComponentId,
        inputKey: input.inputKey,
        reason: `Aggregated source ${String(map.source)} is null`,
      });
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
