import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { roundTripDistanceFactor } from "@/schemas/trip-type";
import type { ProductionRun, Sample, TransportLeg } from "@/db/schema";

export type ProductionRunWithSamples = ProductionRun & {
  samples: Sample[];
  readingsCount: number;
};

export interface AggregatedProductionData {
  weightedOrganicCarbonPercent: number | null;
  weightedHToCorgRatio: number | null;
  weightedOToCorgRatio: number | null;
  weightedAshPercent: number | null;
  weightedMoisturePercent: number | null;
  totalBiocharDryMassKg: number;
  totalFeedstockDryMassKg: number;
  // Diesel is recorded split by use (startup/plant vs genset) but submits as
  // ONE combined `fuel_usage_by_volume` datapoint in litres (issue #319 —
  // energy-use-accounting v1.3 Eq 7: fuel emissions = fuel quantity × a
  // volumetric well-to-wheel EF held as a fixed input on the Isometric
  // template; noma never converts litres to kWh). The two split fields each
  // feed their OWN pyrolysis `fuel_usage_by_volume` component now (the Dark
  // Earth template splits generator vs. startup diesel — see
  // PYROLYSIS_DIESEL_SOURCE_BY_COMPONENT in transformers/datapoint.ts;
  // docs/isometric/changes.md amends #319). Startup = reactor-startup /
  // on-site plant diesel; genset = generator diesel + preprocessing fuel
  // ("summarized").
  totalStartupDieselLitres: number;
  totalGensetDieselLitres: number;
  // Combined diesel litres = totalStartupDieselLitres + totalGensetDieselLitres
  // (both full run totals — PRODUCTION bucket, §8.6.2/ADR 0020). Kept for
  // preview/reporting; the two split fields are what get submitted.
  totalDieselLitres: number;
  totalElectricityKwh: number;
  // Per-category transport mass-distance (tonne·km) = Σⱼ(distⱼ × massⱼ) over
  // the category's legs — the exact quantity Certify's
  // `mass_distance_based_ci_emissions` blueprint multiplies by its fixed
  // emission factor. Summing per-leg contributions IS the mass-weighting (a
  // run's feedstock can arrive across several deliveries / storage bins); it
  // is exact when every leg in the category shares one emission factor
  // (Isometric Transportation v1.1 §5), so a mixed-method/factor or
  // missing-load-mass category surfaces a warning instead of a value
  // (see `aggregateTransportMassDistance`). Caller populates via
  // `enrichWithTransportLegs`.
  //
  // feedstock/biochar are null when no legs are recorded — transport is
  // required for those categories, so a missing value fails closed at submit.
  feedstockTransportMassDistanceTonneKm: number | null;
  biocharTransportMassDistanceTonneKm: number | null;
  // Sample shipment is optional: 0 (a true value — "no sample transport")
  // rather than null when no sample legs exist.
  sampleTransportMassDistanceTonneKm: number;
  earliestStartTime: Date;
  latestEndTime: Date;
  sourceProductionRunIds: string[];
  warnings: string[];
}

// §8.6.2 emission-input buckets (issue #349, ADR 0020). PRODUCTION sources
// front-load IN FULL on the credit batch's claiming GHG entry — no
// applied-mass weighting. DELIVERY and STORED sources scale with the mass
// actually applied in this removal. The submit-side classification is the
// `bucket` attribute on INPUT_MAPPING entries (transformers/datapoint.ts);
// tests/isometric-emission-buckets.test.ts welds the two so they cannot drift.
export type EmissionInputBucket = "production" | "delivery" | "stored";

export const SOURCE_BUCKETS = {
  weightedOrganicCarbonPercent: "stored",
  totalBiocharDryMassKg: "stored", // also biochar-transport feedstock_mass (delivery) — both applied-scoped
  totalFeedstockDryMassKg: "production",
  totalStartupDieselLitres: "production",
  totalGensetDieselLitres: "production",
  totalDieselLitres: "production",
  totalElectricityKwh: "production",
  feedstockTransportMassDistanceTonneKm: "production",
  sampleTransportMassDistanceTonneKm: "production",
  biocharTransportMassDistanceTonneKm: "delivery",
} as const satisfies Partial<
  Record<keyof AggregatedProductionData, EmissionInputBucket>
>;

export function isAppliedScopedSource(
  source: keyof typeof SOURCE_BUCKETS,
): boolean {
  return SOURCE_BUCKETS[source] !== "production";
}

// Aggregates a category's transport legs into a single mass-distance
// (tonne·km) = Σⱼ(distⱼ × massⱼ) — the value Certify's
// `mass_distance_based_ci_emissions` blueprint multiplies by its fixed
// emission factor. Summing per-leg contributions IS the mass-weighting, and is
// exact only when every leg shares that factor (Isometric Transportation v1.1
// §5). The factor is NOT stored on our legs — it lives on the blueprint — so a
// category whose legs differ on the fields that select the factor cannot be
// collapsed into one scalar and surfaces a warning instead.
//
// Returns:
//   { massDistanceTonneKm }  — Σⱼ(distⱼ × massⱼ); null when empty / blocked
//   { warning }              — missing load mass, mixed method/factor, or null
export interface TransportAggregationResult {
  massDistanceTonneKm: number | null;
  warning: string | null;
}

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

export function aggregateTransportMassDistance(
  legs: TransportLeg[],
  categoryLabel: string,
): TransportAggregationResult {
  if (legs.length === 0) {
    return { massDistanceTonneKm: null, warning: null };
  }

  // Every leg needs a load mass to contribute distⱼ × massⱼ. A leg without it
  // would silently drop its tonne·km, under-counting transport emissions.
  const missingMassLegIds = legs
    .filter((leg) => leg.loadMassKg == null || leg.loadMassKg <= 0)
    .map((leg) => leg.id);
  if (missingMassLegIds.length > 0) {
    return {
      massDistanceTonneKm: null,
      warning: `${categoryLabel} transport legs missing load_mass_kg (${missingMassLegIds.join(", ")}) - required for per-leg accounting`,
    };
  }

  const factorWarning = getMixedTransportFactorWarning(legs, categoryLabel);
  if (factorWarning) {
    return {
      massDistanceTonneKm: null,
      warning: factorWarning,
    };
  }

  // Σⱼ(round-trip-factorⱼ × distⱼ_km × massⱼ_tonnes). One mass-distance scalar
  // per category — the single SCALAR the blueprint expects (there is no
  // LIST-shaped transport input in the Certify catalog). Per issue #316 (§4.2
  // ruling, resolved 2026-07-09, interpretation (a)): a `return` leg counts the
  // full round-trip distance (×2 of the stored one-way distance) against the
  // outbound load mass; a `one_way` leg (evidenced onward destination) counts
  // the one-way distance only. The stored `distanceKm` stays one-way; the ×2
  // lives here, not in the leg.
  let massDistanceTonneKm = 0;
  for (const leg of legs) {
    massDistanceTonneKm +=
      roundTripDistanceFactor(leg.tripType) *
      leg.distanceKm *
      kgToTonnes(leg.loadMassKg as number);
  }
  return { massDistanceTonneKm, warning: null };
}

// Clamps a per-run attribution factor into [0, 1]. A removal can only count
// the share of a run's biochar that actually got applied. A missing entry
// (no attribution map, or run absent from it) defaults to 1.0 — the run is
// fully attributed. A non-finite value signals corrupt data and fails safe
// to 0 (the run is excluded) rather than silently counting the whole run.
export function clampFactor(value: number | null | undefined): number {
  if (value == null) return 1;
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// `attributionByRunId` carries the applied-biochar fraction for each run —
// appliedDryKgFromThisRemoval / runTotalBiocharOutput. It scopes ONLY the
// stored-bucket biochar mass and the chemistry weights (see SOURCE_BUCKETS):
// production-bucket inputs (feedstock mass, diesel, electricity) sum the FULL
// run totals — §8.6.2 front-loads them once on the batch's claiming GHG entry
// (issue #349, ADR 0020). Omitted or a missing entry defaults to 1.0 (the run
// is fully attributed).
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
    // STORED bucket: only the applied share is credited (ex-post, unchanged).
    totalBiocharDryMassKg += nz(run.biocharDryMassKg) * factor;
    // PRODUCTION bucket (§8.6.2, ADR 0020): full run totals — front-loaded on
    // the batch's claiming entry, no applied-mass weighting. See SOURCE_BUCKETS.
    totalFeedstockDryMassKg += nz(run.feedstockMassDryKg);
    // Startup bucket = reactor-startup / on-site plant diesel only.
    totalStartupDieselLitres += nz(run.dieselOperationLiters);
    // Genset ("summarized") bucket = generator diesel + preprocessing fuel;
    // preprocess rides with genset per the Dark Earth template's two-component
    // pyrolysis diesel split (docs/isometric/changes.md, amends #319).
    totalGensetDieselLitres +=
      nz(run.dieselGensetLiters) + nz(run.preprocessingFuelLiters);
    totalElectricityKwh += nz(run.electricityKwh);
    if (run.startTime < earliestStartTime) earliestStartTime = run.startTime;
    if (run.endTime > latestEndTime) latestEndTime = run.endTime;

    if (run.biocharDryMassKg == null) {
      warnings.push(`Run ${run.code}: missing biocharDryMassKg`);
    }
    // NOTE: a method-blind "no samples" warning used to live here, but it would
    // wrongly block a valid Method B unsampled run. Sampling sufficiency is now
    // judged method-aware by `evaluateDurabilitySubmissionGates` (D3) in
    // submit-removal.ts; this aggregation stays method-agnostic.
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
    totalDieselLitres: totalStartupDieselLitres + totalGensetDieselLitres,
    totalElectricityKwh,
    // Transport fields default to null/0. Caller enriches via
    // `enrichWithTransportLegs`.
    feedstockTransportMassDistanceTonneKm: null,
    biocharTransportMassDistanceTonneKm: null,
    sampleTransportMassDistanceTonneKm: 0,
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
//
// `options.appliedBiocharFraction` scales the biochar category ONLY — biochar
// transport is the DELIVERY bucket (§8.6.2, ADR 0020) and counts the applied
// share; feedstock/sample legs are PRODUCTION-bucket and stay whole. An
// omitted option means factor 1 via clampFactor's null default.
export function enrichWithTransportLegs(
  agg: AggregatedProductionData,
  legs: TransportLegsByCategory,
  options?: { appliedBiocharFraction?: number },
): AggregatedProductionData {
  const deliveryFactor = clampFactor(options?.appliedBiocharFraction);
  const feedstock = aggregateTransportMassDistance(legs.feedstock, "Feedstock");
  const biochar = aggregateTransportMassDistance(legs.biochar, "Biochar");
  const sample = aggregateTransportMassDistance(legs.sample, "Sample");
  const newWarnings = [
    feedstock.warning,
    biochar.warning,
    sample.warning,
  ].filter((w): w is string => w !== null);

  return {
    ...agg,
    feedstockTransportMassDistanceTonneKm: feedstock.massDistanceTonneKm,
    biocharTransportMassDistanceTonneKm:
      biochar.massDistanceTonneKm == null
        ? null
        : biochar.massDistanceTonneKm * deliveryFactor,
    // Sample shipment is optional, so an empty category collapses to 0 (a
    // true "no sample transport" value); feedstock/biochar stay null when
    // empty so a forgotten required leg fails closed at submit. A blocked
    // sample category (mixed factor / missing mass) yields its warning above
    // AND falls back to 0 here — the pipeline blocks on the warning either way.
    sampleTransportMassDistanceTonneKm: sample.massDistanceTonneKm ?? 0,
    warnings: [...agg.warnings, ...newWarnings],
  };
}

// Mass-weighted by the applied share of run.biocharDryMassKg using the
// per-run mean of `pick` across that run's samples — so the carbon content
// reflects the biochar that actually got applied. Runs with no usable
// samples, zero mass, or a zero attribution factor are dropped from both
// numerator and denominator.
//
// Chemistry weighting deliberately STAYS applied-mass-based (unlike the
// production-bucket sums above): the weighted means characterise the stored
// biochar, which is ex-post applied-scoped (§8.6.2, ADR 0020).
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
