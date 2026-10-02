/**
 * Energy attribution (ADR 0031): turns what operators recorded into activity
 * and estimated kg CO2e per record, and into dated flows for the facility.
 *
 * Rules (docs/plans/2026-10-01-energy-page.md, "Sources and attribution"):
 *
 * - kg CO2e = activity x factor. Grid electricity takes the run's low-carbon
 *   share off first. A null reading is a missing reading, never zero.
 * - Feedstock transport is 2 x one-way km x load tonnes per leg, and is split
 *   across the runs that drew the feedstock by wet mass drawn. What no run
 *   drew stays with the feedstock and reaches no credit batch.
 * - Biochar delivery is 2 x effective km x delivered wet tonnes, split across
 *   the delivery's source runs by dry mass.
 * - A delivery or application carries the production energy of the biochar
 *   it moved: each source run's footprint scaled by the dry mass taken from
 *   that run over the run's dry output.
 *
 * Pure: no database, no clock. The caller supplies facility days.
 */
import { countedRoundTripKm } from "@/lib/calculations/round-trip";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { creditBatchInPeriod, dayInPeriod } from "./period";
import {
  ENERGY_SOURCE_KEYS,
  RUN_SOURCE_KEYS,
  zeroSourceAmounts,
  type EnergySourceKey,
  type RunSourceKey,
  type SourceAmounts,
} from "./sources";
import type {
  EnergyBreakdown,
  EnergyDeliveryInput,
  EnergyFactors,
  EnergyFeedstockInput,
  EnergyFlow,
  EnergyFootprint,
  EnergyGap,
  EnergyInputs,
  EnergyPeriod,
  EnergyProduction,
  EnergyRecord,
  EnergyRunInput,
  EnergyRunShareInput,
  ReadingGap,
  ReadingGapUnit,
} from "./types";

const PERCENT = 100;
/** Float residue below this is not a share worth a flow. */
const SHARE_EPSILON = 1e-9;

/** A recorded amount of one source, with its estimate when factors exist. */
interface Reading {
  activity: number;
  kg: number | null;
}

interface RunCalc {
  run: EnergyRunInput;
  creditBatchId: string | null;
  readings: Record<RunSourceKey, Reading | null>;
  /** Share of each drawn feedstock's transport this run carries. */
  feedstockShares: { feedstockId: string; share: number }[];
}

interface FeedstockCalc {
  feedstock: EnergyFeedstockInput;
  transport: Reading | null;
  /** Share drawn by each listed run; the rest stays unattributed. */
  draws: { runId: string; share: number }[];
}

interface DeliveryCalc {
  delivery: EnergyDeliveryInput;
  transport: Reading | null;
  runShares: EnergyRunShareInput[];
  /** Dry biochar the shares add up to, or the delivery's own dry mass. */
  dryMassKg: number | null;
}

interface Model {
  factors: EnergyFactors | null;
  runs: Map<string, RunCalc>;
  feedstocks: Map<string, FeedstockCalc>;
  deliveries: Map<string, DeliveryCalc>;
}

// ------------------------------------------------------------- readings

function estimate(activity: number, factor: number | undefined): Reading {
  return { activity, kg: factor == null ? null : activity * factor };
}

function runReadings(
  run: EnergyRunInput,
  factors: EnergyFactors | null,
): Record<RunSourceKey, Reading | null> {
  const diesel = factors?.dieselKgCo2ePerLitre;
  const lowCarbonShare =
    Math.min(Math.max(run.lowCarbonPercentage ?? 0, 0), PERCENT) / PERCENT;
  const grid =
    factors == null ? undefined : factors.gridKgCo2ePerKwh * (1 - lowCarbonShare);
  const read = (value: number | null, factor: number | undefined) =>
    value == null ? null : estimate(value, factor);
  return {
    startup: read(run.dieselOperationLiters, diesel),
    genset: read(run.dieselGensetLiters, diesel),
    preprocessing: read(run.preprocessingFuelLiters, diesel),
    grid: read(run.electricityKwh, grid),
  };
}

/** Round-trip tonne-km of a set of legs; null when any load is unknown. */
function legsTonneKm(feedstock: EnergyFeedstockInput): number | null {
  if (feedstock.legs.length === 0) return null;
  let tonneKm = 0;
  for (const leg of feedstock.legs) {
    if (leg.loadMassKg == null || leg.loadMassKg <= 0) return null;
    tonneKm += countedRoundTripKm(leg.distanceKm) * kgToTonnes(leg.loadMassKg);
  }
  return tonneKm;
}

function deliveryTonneKm(delivery: EnergyDeliveryInput): number | null {
  if (delivery.effectiveDistanceKm == null || delivery.deliveredWetMassKg == null) {
    return null;
  }
  return (
    countedRoundTripKm(delivery.effectiveDistanceKm) *
    kgToTonnes(delivery.deliveredWetMassKg)
  );
}

// ----------------------------------------------------------------- model

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const list = out.get(key(item));
    if (list) list.push(item);
    else out.set(key(item), [item]);
  }
  return out;
}

function buildModel(inputs: EnergyInputs, factors: EnergyFactors | null): Model {
  const batchIds = new Set(inputs.creditBatches.map((batch) => batch.id));
  const road = factors?.roadFreightKgCo2ePerTonneKm;

  const runs = new Map<string, RunCalc>();
  for (const run of inputs.runs) {
    runs.set(run.id, {
      run,
      creditBatchId:
        run.creditBatchId && batchIds.has(run.creditBatchId) ? run.creditBatchId : null,
      readings: runReadings(run, factors),
      feedstockShares: [],
    });
  }

  const drawsByFeedstock = groupBy(
    inputs.feedstockDraws.filter((draw) => runs.has(draw.runId) && draw.wetMassKg > 0),
    (draw) => draw.feedstockId,
  );
  const feedstocks = new Map<string, FeedstockCalc>();
  for (const feedstock of inputs.feedstocks) {
    const draws = drawsByFeedstock.get(feedstock.id) ?? [];
    const drawnKg = draws.reduce((total, draw) => total + draw.wetMassKg, 0);
    // Shares never add up to more than the whole feedstock, even when runs
    // drew more wet mass than was received (moisture changes in the bin).
    const basisKg = Math.max(feedstock.wetMassKg ?? 0, drawnKg);
    const tonneKm = legsTonneKm(feedstock);
    const calc: FeedstockCalc = {
      feedstock,
      transport: tonneKm == null ? null : estimate(tonneKm, road),
      draws:
        basisKg > 0
          ? draws.map((draw) => ({ runId: draw.runId, share: draw.wetMassKg / basisKg }))
          : [],
    };
    feedstocks.set(feedstock.id, calc);
    for (const draw of calc.draws) {
      runs.get(draw.runId)?.feedstockShares.push({
        feedstockId: feedstock.id,
        share: draw.share,
      });
    }
  }

  const sharesByDelivery = groupBy(
    inputs.deliveryRunShares.filter((share) => share.dryMassKg > 0),
    (share) => share.ownerId,
  );
  const deliveries = new Map<string, DeliveryCalc>();
  for (const delivery of inputs.deliveries) {
    const runShares = sharesByDelivery.get(delivery.id) ?? [];
    const sharedKg = runShares.reduce((total, share) => total + share.dryMassKg, 0);
    const tonneKm = deliveryTonneKm(delivery);
    deliveries.set(delivery.id, {
      delivery,
      transport: tonneKm == null ? null : estimate(tonneKm, road),
      runShares,
      dryMassKg: sharedKg > 0 ? sharedKg : delivery.massDryKg,
    });
  }

  return { factors, runs, feedstocks, deliveries };
}

// ------------------------------------------------------------ footprints

interface GapTally {
  unit: ReadingGapUnit;
  of: Set<string>;
  missing: Set<string>;
}

interface FootprintTally {
  activity: SourceAmounts;
  kg: SourceAmounts;
  gaps: Partial<Record<EnergySourceKey, GapTally>>;
  runIds: Set<string>;
  deliveryIds: Set<string>;
}

function newTally(): FootprintTally {
  return {
    activity: zeroSourceAmounts(),
    kg: zeroSourceAmounts(),
    gaps: {},
    runIds: new Set(),
    deliveryIds: new Set(),
  };
}

function count(
  tally: FootprintTally,
  source: EnergySourceKey,
  unit: ReadingGapUnit,
  id: string,
  reading: Reading | null,
  scale: number,
): void {
  const gap = tally.gaps[source] ?? { unit, of: new Set(), missing: new Set() };
  tally.gaps[source] = gap;
  gap.of.add(id);
  if (reading == null) {
    gap.missing.add(id);
    return;
  }
  tally.activity[source] += reading.activity * scale;
  tally.kg[source] += (reading.kg ?? 0) * scale;
}

/**
 * Adds a run's production footprint at `scale`. A null scale means the run's
 * share cannot be worked out (no dry output recorded), so every source it
 * would have carried counts as a missing reading.
 */
function addRun(
  tally: FootprintTally,
  model: Model,
  calc: RunCalc,
  scale: number | null,
): void {
  tally.runIds.add(calc.run.id);
  for (const source of RUN_SOURCE_KEYS) {
    count(tally, source, "run", calc.run.id, scale == null ? null : calc.readings[source], scale ?? 0);
  }
  for (const { feedstockId, share } of calc.feedstockShares) {
    const transport = model.feedstocks.get(feedstockId)?.transport ?? null;
    count(
      tally,
      "feedstockTransport",
      "feedstock",
      feedstockId,
      scale == null ? null : transport,
      share * (scale ?? 0),
    );
  }
}

/** Adds the production energy behind dry biochar taken from runs. */
function addCarriedProduction(
  tally: FootprintTally,
  model: Model,
  shares: EnergyRunShareInput[],
): void {
  for (const share of shares) {
    const calc = model.runs.get(share.runId);
    if (!calc) continue;
    const output = calc.run.biocharDryMassKg;
    addRun(tally, model, calc, output != null && output > 0 ? Math.min(share.dryMassKg / output, 1) : null);
  }
}

function addDeliveryTransport(
  tally: FootprintTally,
  calc: DeliveryCalc,
  scale: number,
): void {
  tally.deliveryIds.add(calc.delivery.id);
  count(tally, "biocharTransport", "delivery", calc.delivery.id, calc.transport, scale);
}

function finish(tally: FootprintTally, factors: EnergyFactors | null): EnergyFootprint {
  const gaps: Partial<Record<EnergySourceKey, ReadingGap>> = {};
  for (const source of ENERGY_SOURCE_KEYS) {
    const gap = tally.gaps[source];
    if (gap && gap.missing.size > 0) {
      gaps[source] = { missing: gap.missing.size, of: gap.of.size, unit: gap.unit };
    }
  }
  return { activity: tally.activity, kg: factors ? tally.kg : null, gaps };
}

function batchIdsOf(model: Model, shares: EnergyRunShareInput[]): string[] {
  const ids = new Set<string>();
  for (const share of shares) {
    const batchId = model.runs.get(share.runId)?.creditBatchId;
    if (batchId) ids.add(batchId);
  }
  return [...ids];
}

// --------------------------------------------------------------- records

function runRecords(model: Model): EnergyRecord[] {
  return [...model.runs.values()].map((calc) => {
    const tally = newTally();
    addRun(tally, model, calc, 1);
    return {
      id: calc.run.id,
      scope: "run",
      code: calc.run.code,
      context: calc.run.reactorName,
      day: calc.run.day,
      endDay: null,
      creditBatchIds: calc.creditBatchId ? [calc.creditBatchId] : [],
      footprint: finish(tally, model.factors),
      runCount: 1,
      deliveryCount: 0,
      dryMassKg: calc.run.biocharDryMassKg,
    };
  });
}

function deliveryRecords(model: Model): EnergyRecord[] {
  return [...model.deliveries.values()].map((calc) => {
    const tally = newTally();
    addDeliveryTransport(tally, calc, 1);
    addCarriedProduction(tally, model, calc.runShares);
    return {
      id: calc.delivery.id,
      scope: "delivery",
      code: calc.delivery.code,
      context: calc.delivery.customerName,
      day: calc.delivery.day,
      endDay: null,
      creditBatchIds: batchIdsOf(model, calc.runShares),
      footprint: finish(tally, model.factors),
      runCount: tally.runIds.size,
      deliveryCount: 1,
      dryMassKg: calc.dryMassKg,
    };
  });
}

function applicationRecords(model: Model, inputs: EnergyInputs): EnergyRecord[] {
  const sharesByApplication = groupBy(
    inputs.applicationRunShares.filter((share) => share.dryMassKg > 0),
    (share) => share.ownerId,
  );
  return inputs.applications.map((application) => {
    const delivery = model.deliveries.get(application.deliveryId);
    const deliveryDryKg = delivery?.dryMassKg ?? null;
    const transportScale =
      application.dryMassKg != null && deliveryDryKg != null && deliveryDryKg > 0
        ? Math.min(application.dryMassKg / deliveryDryKg, 1)
        : null;
    // Saved application shares are exact. Without them, the application takes
    // its delivery's run mix in proportion to the dry mass it applied.
    const shares =
      sharesByApplication.get(application.id) ??
      (delivery && transportScale != null
        ? delivery.runShares.map((share) => ({
            ...share,
            ownerId: application.id,
            dryMassKg: share.dryMassKg * transportScale,
          }))
        : []);
    const tally = newTally();
    if (delivery) {
      if (transportScale == null) {
        tally.deliveryIds.add(delivery.delivery.id);
        count(tally, "biocharTransport", "delivery", delivery.delivery.id, null, 0);
      } else {
        addDeliveryTransport(tally, delivery, transportScale);
      }
    }
    addCarriedProduction(tally, model, shares);
    // Without saved shares or a dry mass to scale its delivery's run mix by,
    // the application's production share is unknown: every source those runs
    // would carry counts as a missing reading, never as zero.
    const unscaledRuns =
      !sharesByApplication.has(application.id) && delivery && transportScale == null
        ? delivery.runShares
        : [];
    for (const share of unscaledRuns) {
      const calc = model.runs.get(share.runId);
      if (calc) addRun(tally, model, calc, null);
    }
    return {
      id: application.id,
      scope: "application",
      code: application.code,
      context: application.fieldName ?? delivery?.delivery.customerName ?? null,
      day: application.day,
      endDay: null,
      creditBatchIds: batchIdsOf(model, unscaledRuns.length > 0 ? unscaledRuns : shares),
      footprint: finish(tally, model.factors),
      runCount: tally.runIds.size,
      deliveryCount: tally.deliveryIds.size,
      dryMassKg: application.dryMassKg,
    };
  });
}

function creditBatchRecords(model: Model, inputs: EnergyInputs): EnergyRecord[] {
  return inputs.creditBatches.map((batch) => {
    const tally = newTally();
    let dryMassKg: number | null = null;
    for (const calc of model.runs.values()) {
      if (calc.creditBatchId !== batch.id) continue;
      addRun(tally, model, calc, 1);
      if (calc.run.biocharDryMassKg != null) {
        dryMassKg = (dryMassKg ?? 0) + calc.run.biocharDryMassKg;
      }
    }
    for (const calc of model.deliveries.values()) {
      const batchKg = calc.runShares
        .filter((share) => model.runs.get(share.runId)?.creditBatchId === batch.id)
        .reduce((total, share) => total + share.dryMassKg, 0);
      if (batchKg <= 0 || calc.dryMassKg == null || calc.dryMassKg <= 0) continue;
      addDeliveryTransport(tally, calc, Math.min(batchKg / calc.dryMassKg, 1));
    }
    return {
      id: batch.id,
      scope: "batch",
      code: batch.code,
      context: null,
      day: batch.startDate,
      endDay: batch.endDate,
      creditBatchIds: [batch.id],
      footprint: finish(tally, model.factors),
      runCount: tally.runIds.size,
      deliveryCount: tally.deliveryIds.size,
      dryMassKg,
    };
  });
}

// ----------------------------------------------------------------- flows

function facilityFlows(model: Model): { flows: EnergyFlow[]; gaps: EnergyGap[] } {
  const flows: EnergyFlow[] = [];
  const gaps: EnergyGap[] = [];
  const push = (
    source: EnergySourceKey,
    creditBatchId: string | null,
    day: string,
    reading: Reading,
    share: number,
  ) => {
    if (share <= SHARE_EPSILON) return;
    flows.push({
      source,
      creditBatchId,
      day,
      activity: reading.activity * share,
      kg: reading.kg == null ? null : reading.kg * share,
    });
  };

  for (const calc of model.runs.values()) {
    for (const source of RUN_SOURCE_KEYS) {
      const reading = calc.readings[source];
      if (reading) push(source, calc.creditBatchId, calc.run.day, reading, 1);
      else {
        gaps.push({
          source,
          creditBatchIds: calc.creditBatchId ? [calc.creditBatchId] : [],
          day: calc.run.day,
          recordId: calc.run.id,
        });
      }
    }
  }

  for (const calc of model.feedstocks.values()) {
    const batchOf = (runId: string) => model.runs.get(runId)?.creditBatchId ?? null;
    if (!calc.transport) {
      gaps.push({
        source: "feedstockTransport",
        creditBatchIds: [...new Set(calc.draws.map((draw) => batchOf(draw.runId)).filter((id): id is string => id != null))],
        day: calc.feedstock.day,
        recordId: calc.feedstock.id,
      });
      continue;
    }
    let drawn = 0;
    for (const draw of calc.draws) {
      push("feedstockTransport", batchOf(draw.runId), calc.feedstock.day, calc.transport, draw.share);
      drawn += draw.share;
    }
    push("feedstockTransport", null, calc.feedstock.day, calc.transport, 1 - drawn);
  }

  for (const calc of model.deliveries.values()) {
    const batchOf = (runId: string) => model.runs.get(runId)?.creditBatchId ?? null;
    if (!calc.transport) {
      gaps.push({
        source: "biocharTransport",
        creditBatchIds: batchIdsOf(model, calc.runShares),
        day: calc.delivery.day,
        recordId: calc.delivery.id,
      });
      continue;
    }
    const sharedKg = calc.runShares.reduce((total, share) => total + share.dryMassKg, 0);
    if (sharedKg <= 0) {
      push("biocharTransport", null, calc.delivery.day, calc.transport, 1);
      continue;
    }
    for (const share of calc.runShares) {
      push("biocharTransport", batchOf(share.runId), calc.delivery.day, calc.transport, share.dryMassKg / sharedKg);
    }
  }

  return { flows: mergeFlows(flows), gaps };
}

/** One flow per source, credit batch and day keeps the payload small. */
function mergeFlows(flows: EnergyFlow[]): EnergyFlow[] {
  const merged = new Map<string, EnergyFlow>();
  for (const flow of flows) {
    const key = `${flow.source}|${flow.creditBatchId ?? ""}|${flow.day}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...flow });
      continue;
    }
    existing.activity += flow.activity;
    existing.kg = existing.kg == null || flow.kg == null ? null : existing.kg + flow.kg;
  }
  return [...merged.values()];
}

// ------------------------------------------------------------- breakdown

function firstDay(inputs: EnergyInputs): string | null {
  const days = [
    ...inputs.runs.map((run) => run.day),
    ...inputs.feedstocks.map((feedstock) => feedstock.day),
    ...inputs.deliveries.map((delivery) => delivery.day),
    ...inputs.applications.map((application) => application.day),
  ];
  return days.length === 0 ? null : days.reduce((min, day) => (day < min ? day : min));
}

/**
 * The energy estimate for one facility and period. `inputs` must hold the
 * facility's whole history: a delivery in the period carries biochar made by
 * runs before it, and a credit batch reaches back to its first run.
 */
export function buildEnergyBreakdown(
  inputs: EnergyInputs,
  factors: EnergyFactors | null,
  period: EnergyPeriod,
): EnergyBreakdown {
  const model = buildModel(inputs, factors);
  const from = period.from ?? firstDay(inputs) ?? period.to;
  const resolved: EnergyPeriod = { from, to: period.to };
  const inPeriod = (record: EnergyRecord) =>
    record.scope === "batch"
      ? creditBatchInPeriod({ startDate: record.day, endDate: record.endDay ?? record.day }, resolved)
      : dayInPeriod(record.day, resolved);

  const records = [
    ...creditBatchRecords(model, inputs),
    ...runRecords(model),
    ...deliveryRecords(model),
    ...applicationRecords(model, inputs),
  ].filter(inPeriod);

  const { flows, gaps } = facilityFlows(model);
  const production: EnergyProduction[] = [...model.runs.values()]
    .filter((calc) => calc.run.biocharDryMassKg != null && dayInPeriod(calc.run.day, resolved))
    .map((calc) => ({
      creditBatchId: calc.creditBatchId,
      dryMassKg: calc.run.biocharDryMassKg ?? 0,
    }));

  return {
    from,
    to: period.to,
    factors,
    creditBatches: inputs.creditBatches,
    records,
    flows: flows.filter((flow) => dayInPeriod(flow.day, resolved)),
    gaps: gaps.filter((gap) => dayInPeriod(gap.day, resolved)),
    production,
  };
}
