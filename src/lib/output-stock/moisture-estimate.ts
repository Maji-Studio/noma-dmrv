import { add, compare, decimal, divide, rational, rationalToNumber, subtract, type Rational } from './exact';
import { layerRemainingSolidsKg, type OutputStockRequest, type planOutputStock } from './planner';

const PERCENT = 100;

/** A count's measured moisture on one layer, with the solids the layer held right after it. */
export interface MoistureReading {
  moisturePercent: number;
  /** Solids the layer held right after the count; the reading's wet mass is these at the reading. */
  solidsKg: Rational;
  occurredAt: string;
  /** Posting order of the measuring movement; breaks ties at one instant. */
  sequence: bigint;
}

/** Wet mass a removal took from one layer, at the time of the movement. */
export interface WetRemoval {
  wetKg: Rational;
  occurredAt: string;
  sequence: bigint;
}

/** What one layer holds and what its wet mass and moisture are known from. */
export interface LayerMoistureBasis {
  layerId: string;
  /** Canonical ISO instant the layer entered the bin. */
  placedAt: string;
  remainingSolidsKg: Rational;
  /** Solids and wet mass recorded when the layer entered the bin; null when its wet mass is unknown. */
  recorded: { solidsKg: Rational; wetKg: Rational } | null;
  /** Count readings: a count weighs the whole bin, so it sets the wet mass and moisture again. */
  readings: readonly MoistureReading[];
  /** Wet mass every removal took. A removal's own moisture reading never changes the layer's moisture. */
  removals: readonly WetRemoval[];
}

export interface MoistureBasis { source: 'reading' | 'recorded'; at: string }

export interface StockEstimate {
  solidsKg: number;
  /** Null when a layer holding solids has no moisture to estimate it from. */
  wetKg: number | null;
  moisturePercent: number | null;
  /** The most recent basis among the layers holding solids. */
  basis: MoistureBasis | null;
}

const toNumber = rationalToNumber;
const ZERO = rational(BigInt(0));

/** 1 − moisture, exact. Stored percents have at most six decimals, so the text form is exact. */
function readingFraction(moisturePercent: number): Rational {
  return subtract(rational(BigInt(1)), divide(decimal(String(moisturePercent)), rational(BigInt(PERCENT))));
}

/** True when `a` happened after `b`: a later instant, or the same instant posted later. */
function isAfter(a: { occurredAt: string; sequence: bigint }, b: { occurredAt: string; sequence: bigint }): boolean {
  return a.occurredAt > b.occurredAt || (a.occurredAt === b.occurredAt && a.sequence > b.sequence);
}

/** The newest reading at or before `at`: later instant first, then later posting. */
function latestReading(readings: readonly MoistureReading[], at: string): MoistureReading | null {
  let latest: MoistureReading | null = null;
  for (const reading of readings) {
    if (reading.occurredAt > at) continue;
    if (!latest || isAfter(reading, latest)) latest = reading;
  }
  return latest;
}

/**
 * A layer's wet mass at `at` and the moisture it keeps. The wet mass starts
 * from the latest count, or else from what the layer entered the bin with,
 * and every later removal subtracts the wet mass it took. The moisture stays
 * at that starting point: a drier or wetter removal moves the dry biochar it
 * takes, not the moisture of what is left. Null when the layer's wet mass is unknown.
 */
function layerWet(layer: LayerMoistureBasis, at: string): { wetKg: Rational; fraction: Rational; basis: MoistureBasis } | null {
  const reading = latestReading(layer.readings, at);
  let start: { wetKg: Rational; fraction: Rational; basis: MoistureBasis; since: WetRemoval | null };
  if (reading) {
    const fraction = readingFraction(reading.moisturePercent);
    start = { wetKg: divide(reading.solidsKg, fraction), fraction, basis: { source: 'reading', at: reading.occurredAt }, since: { ...reading, wetKg: ZERO } };
  } else {
    const { recorded } = layer;
    if (!recorded || recorded.wetKg.numerator <= BigInt(0)) return null;
    start = { wetKg: recorded.wetKg, fraction: divide(recorded.solidsKg, recorded.wetKg), basis: { source: 'recorded', at: layer.placedAt }, since: null };
  }
  let wetKg = start.wetKg;
  for (const removal of layer.removals) {
    if (removal.occurredAt > at || (start.since && !isAfter(removal, start.since))) continue;
    wetKg = subtract(wetKg, removal.wetKg);
  }
  // Removals wetter than the layer can take its wet mass before its dry biochar; none is left to show.
  return { wetKg: compare(wetKg, ZERO) > BigInt(0) ? wetKg : ZERO, fraction: start.fraction, basis: start.basis };
}

/**
 * The stock of the layers present at `at`. Wet mass is each layer's wet mass
 * in minus wet mass out, so a removal of 300 kg from 500 kg leaves 200 kg
 * whatever moisture it was measured at. Dry biochar alone limits a draw: when
 * removals were drier than the bin, its dry biochar runs out while some wet
 * mass still shows. Estimated moisture is each layer's kept moisture, weighted
 * by its remaining solids, so a pro-rata mix removal leaves it unchanged.
 */
export function estimateStock(layers: readonly LayerMoistureBasis[], at: string): StockEstimate {
  let solids = ZERO;
  let wet: Rational | null = ZERO;
  let solidsAtMoisture: Rational | null = ZERO;
  let basis: MoistureBasis | null = null;
  for (const layer of layers) {
    if (layer.placedAt > at || layer.remainingSolidsKg.numerator <= BigInt(0)) continue;
    solids = add(solids, layer.remainingSolidsKg);
    const known = layerWet(layer, at);
    if (!known) { wet = null; solidsAtMoisture = null; continue; }
    if (wet) wet = add(wet, known.wetKg);
    if (solidsAtMoisture) solidsAtMoisture = add(solidsAtMoisture, divide(layer.remainingSolidsKg, known.fraction));
    if (!basis || known.basis.at > basis.at) basis = known.basis;
  }
  const moisture = solidsAtMoisture && solidsAtMoisture.numerator > BigInt(0) ? toNumber(subtract(rational(BigInt(1)), divide(solids, solidsAtMoisture))) * PERCENT : null;
  return { solidsKg: toNumber(solids), wetKg: wet ? toNumber(wet) : null, moisturePercent: moisture, basis };
}

/** A reading a posting records on one layer, with the solids the layer holds right after it. */
export interface PlannedReading { layerId: string; moisturePercent: number; solidsKg: Rational }

/**
 * The readings a planned movement records. Only a count records any: it weighs
 * the whole bin, so its reading sets every layer present, at the solids each
 * holds after it. A removal's reading measures what left, not what stayed, so
 * it records none. A layer the count empties has no moisture left to set, and
 * a zero count measured none.
 */
export function planReadings(request: OutputStockRequest, plan: Pick<ReturnType<typeof planOutputStock>, 'remainingLayers'>, occurredAt: string): PlannedReading[] {
  if (request.kind !== 'count' || request.moisturePercent == null || !(Number(request.wetKg) > 0)) return [];
  const moisturePercent = Number(request.moisturePercent);
  return plan.remainingLayers.flatMap(layer => {
    const solidsKg = layer.placedAt <= occurredAt ? layerRemainingSolidsKg(layer) : null;
    return solidsKg && solidsKg.numerator > BigInt(0) ? [{ layerId: layer.id, moisturePercent, solidsKg }] : [];
  });
}

/** The wet mass a planned removal takes from each layer; a count takes none. */
export function planWetRemovals(plan: Pick<ReturnType<typeof planOutputStock>, 'allocations'>): { layerId: string; wetKg: Rational }[] {
  return plan.allocations.flatMap(allocation => allocation.wetShareKg ? [{ layerId: allocation.layerId, wetKg: allocation.wetShareKg }] : []);
}

/** Layers with a movement's readings and wet removals added, taken at `occurredAt` by the posting `sequence`. */
export function withMovement(layers: readonly LayerMoistureBasis[], movement: { readings: readonly PlannedReading[]; removals: readonly { layerId: string; wetKg: Rational }[] }, occurredAt: string, sequence: bigint): LayerMoistureBasis[] {
  return layers.map(layer => {
    const readings = movement.readings.filter(reading => reading.layerId === layer.layerId).map(reading => ({ moisturePercent: reading.moisturePercent, solidsKg: reading.solidsKg, occurredAt, sequence }));
    const removals = movement.removals.filter(removal => removal.layerId === layer.layerId).map(removal => ({ wetKg: removal.wetKg, occurredAt, sequence }));
    return readings.length || removals.length ? { ...layer, readings: [...layer.readings, ...readings], removals: [...layer.removals, ...removals] } : layer;
  });
}
