import { positiveOrNull } from "@/lib/calculations/transport-leg";
import { countedRoundTripKm } from "@/lib/calculations/round-trip";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { formatCount } from "@/lib/copy-utils";
import { SafeError } from "@/lib/errors";
import type { ProductionRun, Sample, TransportLeg } from "@/db/schema";

const TRANSPORT_FACTOR_REVIEW =
  "Check that the removal template's transport factor covers every vehicle used.";

export type ProductionRunWithSamples = ProductionRun & {
  samples: Sample[];
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
// `bucket` on each aggregated-datapoint role in the semantic binding catalog
// (semantic-binding-catalog.ts); tests/isometric-emission-buckets.test.ts
// welds the two so they cannot drift.
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
// emission factor, a fixed template input. Vehicle type and model year are
// Transportation module records, not factor selectors. Mixed methods or modes
// still block aggregation; mixed vehicle records produce a separate advisory.
//
// Returns:
//   { massDistanceTonneKm }  — Σⱼ(distⱼ × massⱼ); null when empty / blocked
//   { warning }              — missing load mass, mixed method/mode, or null
export interface TransportAggregationResult {
  massDistanceTonneKm: number | null;
  warning: string | null;
}

function getMixedTransportFactorWarning(
  legs: TransportLeg[],
  categoryLabel: string,
): string | null {
  const first = legs[0];
  if (!first) return null;
  if (legs.some((leg) => leg.calculationMethodType !== first.calculationMethodType)) {
    return `${categoryLabel} transport legs use different calculation methods. Check the recorded methods against the removal template.`;
  }
  if (legs.some((leg) => leg.transportMethodType !== first.transportMethodType)) {
    return `${categoryLabel} transport legs use different transport modes. Check the recorded modes against the removal template.`;
  }
  return null;
}

function transportLegLabel(leg: TransportLeg): string {
  return leg.originName && leg.destinationName
    ? `${leg.originName} to ${leg.destinationName}`
    : leg.id;
}

/** Vehicle records never block aggregation or select the template's factor. */
export function transportVehicleAdvisories(
  legs: TransportLeg[],
  categoryLabel: string,
): string[] {
  if (legs.length === 0) return [];
  const advisories: string[] = [];
  const recordedTypes = new Set(legs.flatMap((leg) => leg.vehicleType == null ? [] : [leg.vehicleType]));
  if (recordedTypes.size > 1) {
    advisories.push(
      `${categoryLabel} transport uses more than one vehicle type. ${TRANSPORT_FACTOR_REVIEW}`,
    );
  }
  // Delivery-derived biochar legs have no vehicle input. Feedstock and sample legs do.
  const missingVehicleTypeLegs = legs.filter((leg) =>
    leg.vehicleType == null && !(leg.isDerived && leg.entityType === "biochar"),
  );
  if (missingVehicleTypeLegs.length > 0) {
    advisories.push(
      `${categoryLabel} transport has ${formatCount(missingVehicleTypeLegs.length, "leg")} without a vehicle type (${missingVehicleTypeLegs.map(transportLegLabel).join(", ")}). Record the vehicle type on each leg when it is known.`,
    );
  }
  // Only derived feedstock legs copy a fleet model year; manual forms have
  // no year input. Keep comparing any recorded years, including snapshots.
  const modelYearLegs = legs.filter((leg) =>
    leg.modelYear != null || (leg.isDerived && leg.entityType === "feedstock"),
  );
  if (modelYearLegs.some((leg) => leg.modelYear !== modelYearLegs[0].modelYear)) {
    advisories.push(
      `${categoryLabel} transport has different or unrecorded model years. ${TRANSPORT_FACTOR_REVIEW}`,
    );
  }
  return advisories;
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
  const missingMassLegs = legs.filter(
    (leg) => positiveOrNull(leg.loadMassKg) == null,
  );
  if (missingMassLegs.length > 0) {
    const missingMassLegLabels = missingMassLegs.map(transportLegLabel);
    return {
      massDistanceTonneKm: null,
      warning: `${categoryLabel} transport has ${formatCount(missingMassLegs.length, "leg")} without a load mass (${missingMassLegLabels.join(", ")}). Record a load mass for each leg before submitting.`,
    };
  }

  const factorWarning = getMixedTransportFactorWarning(legs, categoryLabel);
  if (factorWarning) {
    return {
      massDistanceTonneKm: null,
      warning: factorWarning,
    };
  }

  // Σⱼ(2 × distⱼ_km × massⱼ_tonnes). One mass-distance scalar per category:
  // the single SCALAR the blueprint expects (there is no LIST-shaped transport
  // input in the Certify catalog). Every leg counts its full round trip (×2 of
  // the stored one-way distance) against the outbound load mass, because the
  // vehicle returns empty (Transportation v1.1 §5, issue #852). The stored
  // `distanceKm` stays one way; the ×2 lives here, not in the leg.
  let massDistanceTonneKm = 0;
  for (const leg of legs) {
    massDistanceTonneKm +=
      countedRoundTripKm(leg.distanceKm) *
      kgToTonnes(leg.loadMassKg as number);
  }
  return { massDistanceTonneKm, warning: null };
}

/** Shared biochar calculation for submission, coverage and evidence-ledger totals. */
export function aggregateBiocharTransportMassDistance(legs: TransportLeg[]): TransportAggregationResult {
  const checked = aggregateTransportMassDistance(legs, "Biochar");
  if (checked.warning || !legs.length) return checked;
  const missingDistanceLegs = legs.filter((leg) => positiveOrNull(leg.distanceKm) == null);
  if (missingDistanceLegs.length > 0) {
    return {
      massDistanceTonneKm: null,
      warning: `Biochar transport has ${formatCount(missingDistanceLegs.length, "delivery", "deliveries")} without a positive distance (${missingDistanceLegs.map(transportLegLabel).join(", ")}). Record a positive distance for each delivery before submitting.`,
    };
  }
  return checked;
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
  options?: { productionRunIds?: ReadonlySet<string> },
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
  // Narrowed to a concrete Date by the open-run guard in the loop below.
  let latestEndTime: Date | null = null;

  for (const run of runs) {
    // A run reaching aggregation must be closed — its window feeds emission
    // accounting. An open run (NULL end) is a data error
    // here; fail loudly naming the run rather than substitute a time (#259).
    if (run.endTime == null) {
      throw new SafeError(
        `Production run ${run.code} has no end time. Complete the run before certification.`,
      );
    }
    const runEndTime = run.endTime;
    const factor = clampFactor(attributionByRunId?.get(run.id));
    const includeProduction =
      options?.productionRunIds == null || options.productionRunIds.has(run.id);
    // STORED bucket: only the applied share is credited (ex-post, unchanged).
    totalBiocharDryMassKg += nz(run.biocharDryMassKg) * factor;
    // PRODUCTION bucket (§8.6.2, ADR 0020): full run totals — front-loaded on
    // the batch's claiming entry, no applied-mass weighting. See SOURCE_BUCKETS.
    if (includeProduction) {
      totalFeedstockDryMassKg += nz(run.feedstockMassDryKg);
    // Startup bucket = reactor-startup / on-site plant diesel only.
      totalStartupDieselLitres += nz(run.dieselOperationLiters);
    // Genset ("summarized") bucket = generator diesel + preprocessing fuel;
    // preprocess rides with genset per the Dark Earth template's two-component
    // pyrolysis diesel split (docs/isometric/changes.md, amends #319).
      totalGensetDieselLitres +=
        nz(run.dieselGensetLiters) + nz(run.preprocessingFuelLiters);
      totalElectricityKwh += nz(run.electricityKwh);
    }
    if (run.startTime < earliestStartTime) earliestStartTime = run.startTime;
    if (latestEndTime == null || runEndTime > latestEndTime) latestEndTime = runEndTime;

    if (run.biocharDryMassKg == null) {
      warnings.push(`Run ${run.code}: missing biocharDryMassKg`);
    }
    // NOTE: a method-blind "no samples" warning used to live here, but it would
    // wrongly block a valid Method B unsampled run. Sampling sufficiency is now
    // judged method-aware by `evaluateDurabilitySubmissionGates` (D3) in
    // submit-removal.ts; this aggregation stays method-agnostic.
  }

  // Unreachable — the loop runs at least once (runs is non-empty) and each
  // iteration either throws on a null end or sets latestEndTime — but it narrows
  // the type for the `latestEndTime: Date` field below.
  if (latestEndTime == null) {
    throw new SafeError(
      "No complete production runs are available. Complete a production run before certification.",
    );
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
  /** Removal-scoped delivery rows carrying immutable applied wet loads. */
  biochar: TransportLeg[];
  sample: TransportLeg[];
}

// Layers transport-leg distances onto an existing aggregation result.
// Pure: returns a new object, doesn't mutate `agg`. Per-category warnings
// (mixed methods/factors, missing per-leg data) are appended to
// `agg.warnings`, which the submission pipeline short-circuits on.
//
// Biochar legs already carry the Removal's immutable wet application slices.
export function enrichWithTransportLegs(
  agg: AggregatedProductionData,
  legs: TransportLegsByCategory,
): AggregatedProductionData {
  const feedstock = aggregateTransportMassDistance(legs.feedstock, "Feedstock");
  const biochar = aggregateBiocharTransportMassDistance(legs.biochar);
  const sample = aggregateTransportMassDistance(legs.sample, "Sample");
  const newWarnings = [
    feedstock.warning,
    biochar.warning,
    sample.warning,
  ].filter((w): w is string => w !== null);

  return {
    ...agg,
    feedstockTransportMassDistanceTonneKm: feedstock.massDistanceTonneKm,
    biocharTransportMassDistanceTonneKm: biochar.massDistanceTonneKm,
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
