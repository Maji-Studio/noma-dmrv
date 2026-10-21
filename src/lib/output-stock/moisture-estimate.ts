import { add, compare, decimal, divide, multiply, rational, rationalToNumber, subtract, type Rational } from './exact';
import type { OutputStockMode } from './stock-mode';
import { layerRemainingSolidsKg, type OutputStockRequest, type planOutputStock } from './planner';

const PERCENT = 100;

/** A count's measured moisture on one layer, with the solids the layer held right after it. */
export interface MoistureReading {
  moisturePercent: number;
  /** Solids the layer held right after the count; the reading's wet mass is these at the reading. */
  solidsKg: Rational;
  occurredAt: string;
  /** Posting order of the measuring movement: the last posted count sets the layer's wet mass. */
  sequence: bigint;
}

/** Wet mass a removal took from one layer. */
export interface WetRemoval {
  /** Mode in force at the removal time; replay still follows posting order. */
  stockMode?: OutputStockMode;
  wetKg: Rational;
  /** Remaining solids immediately after this draw. */
  solidsKg: Rational;
  moisturePercent?: number | null;
  occurredAt?: string;
  kind?: string;
  /**
   * Posting order of the removal's movement. The dry layers reflect every
   * posted draw whatever its time, so a removal counts by when it was posted,
   * never by when it happened.
   */
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
  /** Wet mass every removal took. Its moisture changes the estimate only if wet would fall below solids. */
  removals: readonly WetRemoval[];
}

export type MoistureBasis = { source: 'reading' | 'recorded'; at: string }
  | { source: 'removal'; at: string; kind: string };

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

interface WetState {
  wetKg: Rational;
  fraction: Rational;
  basis: MoistureBasis;
  reestimateSequence: bigint | null;
}

/** Replay postings together: a mix draw tests the whole pile, a split draw each sub-bin. */
function layerWetStates(layers: readonly LayerMoistureBasis[]): Map<string, WetState | null> {
  const states = new Map<string, WetState | null>();
  const postings = new Map<bigint, { readings: { id: string; reading: MoistureReading }[]; removals: { id: string; removal: WetRemoval }[] }>();
  const posting = (sequence: bigint) => {
    let value = postings.get(sequence);
    if (!value) { value = { readings: [], removals: [] }; postings.set(sequence, value); }
    return value;
  };
  for (const layer of layers) {
    const recorded = layer.recorded;
    states.set(layer.layerId, recorded && recorded.wetKg.numerator > BigInt(0) ? {
      wetKg: recorded.wetKg, fraction: divide(recorded.solidsKg, recorded.wetKg),
      basis: { source: 'recorded', at: layer.placedAt }, reestimateSequence: null,
    } : null);
    for (const reading of layer.readings) posting(reading.sequence).readings.push({ id: layer.layerId, reading });
    for (const removal of layer.removals) posting(removal.sequence).removals.push({ id: layer.layerId, removal });
  }
  for (const [, { readings, removals }] of [...postings].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    for (const { id, removal } of removals) {
      const state = states.get(id);
      if (state) state.wetKg = subtract(state.wetKg, removal.wetKg);
    }
    const groups = removals[0]?.removal.stockMode === 'mix' ? [removals] : removals.map(removal => [removal]);
    for (const group of groups) {
      // Unknown wet stock cannot establish that the pile fell below solids.
      if (group.some(({ id }) => !states.get(id))) continue;
      const wet = group.reduce((sum, { id }) => add(sum, states.get(id)!.wetKg), ZERO);
      const solids = group.reduce((sum, { removal }) => add(sum, removal.solidsKg), ZERO);
      if (compare(wet, solids) >= BigInt(0)) continue;
      for (const { id, removal } of group) {
        const state = states.get(id)!;
        if (removal.moisturePercent != null && removal.occurredAt && removal.kind) {
          state.fraction = readingFraction(removal.moisturePercent);
          state.wetKg = divide(removal.solidsKg, state.fraction);
          state.basis = { source: 'removal', at: removal.occurredAt, kind: removal.kind };
          state.reestimateSequence = removal.sequence;
        } else {
          state.wetKg = removal.solidsKg;
        }
      }
    }
    for (const { id, reading } of readings) {
      const fraction = readingFraction(reading.moisturePercent);
      states.set(id, { wetKg: divide(reading.solidsKg, fraction), fraction,
        basis: { source: 'reading', at: reading.occurredAt }, reestimateSequence: null });
    }
  }
  return states;
}

/** Whether this posting re-estimated a held layer, even if another layer has a later physical basis date. */
export function movementReestimates(layers: readonly LayerMoistureBasis[], at: string, sequence: bigint): boolean {
  const states = layerWetStates(layers);
  return layers.some(layer => layer.placedAt <= at && layer.remainingSolidsKg.numerator > BigInt(0)
    && states.get(layer.layerId)?.reestimateSequence === sequence);
}

/** A stock estimate in exact figures; `estimateStock` converts it for display. */
export interface ExactStockEstimate {
  solidsKg: Rational;
  wetKg: Rational | null;
  moisturePercent: Rational | null;
  basis: MoistureBasis | null;
}

/**
 * True when `next` is a more recent basis than `current`. At one instant a
 * reading beats a removal, then recorded; movement kind breaks removal ties,
 * so the choice never depends on the order layers arrive in.
 */
function isLaterBasis(next: MoistureBasis, current: MoistureBasis | null): boolean {
  if (!current || next.at > current.at) return true;
  const priority = { recorded: 0, removal: 1, reading: 2 };
  return next.at === current.at && (priority[next.source] > priority[current.source]
    || (next.source === 'removal' && current.source === 'removal' && next.kind > current.kind));
}

/**
 * The stock of the layers placed by `at`. Wet mass is each layer's wet mass
 * in minus wet mass out, so a removal of 300 kg from 500 kg leaves 200 kg
 * unless that leaves less wet mass than solids and needs re-estimating.
 * Dry biochar alone limits a draw: when
 * removals were drier than the bin, its dry biochar runs out while some wet
 * mass still shows. Estimated moisture is each layer's kept moisture, weighted
 * by its remaining solids, so a pro-rata mix removal normally leaves it unchanged.
 * `selectedIds` narrows the result only; every layer still participates in replay.
 */
export function estimateStockExact(layers: readonly LayerMoistureBasis[], at: string, selectedIds?: ReadonlySet<string>): ExactStockEstimate {
  const states = layerWetStates(layers);
  let solids = ZERO;
  let wet: Rational | null = ZERO;
  let solidsAtMoisture: Rational | null = ZERO;
  let basis: MoistureBasis | null = null;
  for (const layer of layers) {
    if ((selectedIds && !selectedIds.has(layer.layerId)) || layer.placedAt > at || layer.remainingSolidsKg.numerator <= BigInt(0)) continue;
    solids = add(solids, layer.remainingSolidsKg);
    const known = states.get(layer.layerId);
    if (!known) { wet = null; solidsAtMoisture = null; continue; }
    if (wet) wet = add(wet, known.wetKg);
    if (solidsAtMoisture) solidsAtMoisture = add(solidsAtMoisture, divide(layer.remainingSolidsKg, known.fraction));
    if (isLaterBasis(known.basis, basis)) basis = known.basis;
  }
  const moisture = solidsAtMoisture && solidsAtMoisture.numerator > BigInt(0)
    ? multiply(subtract(rational(BigInt(1)), divide(solids, solidsAtMoisture)), rational(BigInt(PERCENT))) : null;
  return { solidsKg: solids, wetKg: wet, moisturePercent: moisture, basis };
}

/** `estimateStockExact` as display numbers. */
export function estimateStock(layers: readonly LayerMoistureBasis[], at: string, selectedIds?: ReadonlySet<string>): StockEstimate {
  const exact = estimateStockExact(layers, at, selectedIds);
  return { solidsKg: toNumber(exact.solidsKg), wetKg: exact.wetKg ? toNumber(exact.wetKg) : null,
    moisturePercent: exact.moisturePercent ? toNumber(divide(exact.moisturePercent, rational(BigInt(PERCENT)))) * PERCENT : null, basis: exact.basis };
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
export function planWetRemovals(plan: Pick<ReturnType<typeof planOutputStock>, 'allocations' | 'remainingLayers'>) {
  return plan.allocations.flatMap(allocation => allocation.wetShareKg ? [{ layerId: allocation.layerId, wetKg: allocation.wetShareKg,
    solidsKg: layerRemainingSolidsKg(plan.remainingLayers.find(layer => layer.id === allocation.layerId)!),
    moisturePercent: allocation.readingPercent == null ? null : Number(allocation.readingPercent) }] : []);
}

/** Layers with a movement's readings and wet removals added, taken at `occurredAt` by the posting `sequence`. */
export function withMovement(layers: readonly LayerMoistureBasis[], movement: { readings: readonly PlannedReading[]; removals: readonly (Omit<WetRemoval, 'sequence'> & { layerId: string })[] }, occurredAt: string, sequence: bigint, kind: string, stockMode: OutputStockMode = 'split'): LayerMoistureBasis[] {
  return layers.map(layer => {
    const readings = movement.readings.filter(reading => reading.layerId === layer.layerId).map(reading => ({ moisturePercent: reading.moisturePercent, solidsKg: reading.solidsKg, occurredAt, sequence }));
    const removals = movement.removals.filter(removal => removal.layerId === layer.layerId).map(removal => ({ wetKg: removal.wetKg, solidsKg: removal.solidsKg, moisturePercent: removal.moisturePercent, occurredAt, sequence, kind, stockMode }));
    return readings.length || removals.length ? { ...layer, readings: [...layer.readings, ...readings], removals: [...layer.removals, ...removals] } : layer;
  });
}
