import { add, decimal, divide, rational, rationalToNumber, subtract, type Rational } from './exact';
import { layerRemainingSolidsKg, type DrawPolicy, type OutputStockLayer, type OutputStockRequest, type planOutputStock } from './planner';

const PERCENT = 100;

/** A measured moisture on one layer, at the time of the movement that took it. */
export interface MoistureReading {
  moisturePercent: number;
  occurredAt: string;
  /** Posting order of the measuring movement; breaks ties at one instant. */
  sequence: bigint;
}

/** What one layer holds and what its moisture is known from. */
export interface LayerMoistureBasis {
  layerId: string;
  /** Canonical ISO instant the layer entered the bin. */
  placedAt: string;
  remainingSolidsKg: Rational;
  /** Solids and wet mass recorded when the layer entered the bin; null when its wet mass is unknown. */
  recorded: { solidsKg: Rational; wetKg: Rational } | null;
  readings: readonly MoistureReading[];
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

/** 1 − moisture, exact. Stored percents have at most six decimals, so the text form is exact. */
function readingFraction(moisturePercent: number): Rational {
  return subtract(rational(BigInt(1)), divide(decimal(String(moisturePercent)), rational(BigInt(PERCENT))));
}

/** The newest reading at or before `at`: later instant first, then later posting. */
function latestReading(readings: readonly MoistureReading[], at: string): MoistureReading | null {
  let latest: MoistureReading | null = null;
  for (const reading of readings) {
    if (reading.occurredAt > at) continue;
    if (!latest || reading.occurredAt > latest.occurredAt || (reading.occurredAt === latest.occurredAt && reading.sequence > latest.sequence)) latest = reading;
  }
  return latest;
}

/** A layer's solids fraction (1 − moisture) at `at` and where it comes from, or null when unknown. */
function layerSolidsFraction(layer: LayerMoistureBasis, at: string): { fraction: Rational; basis: MoistureBasis } | null {
  const reading = latestReading(layer.readings, at);
  if (reading) return { fraction: readingFraction(reading.moisturePercent), basis: { source: 'reading', at: reading.occurredAt } };
  const { recorded } = layer;
  if (!recorded || recorded.wetKg.numerator <= BigInt(0)) return null;
  return { fraction: divide(recorded.solidsKg, recorded.wetKg), basis: { source: 'recorded', at: layer.placedAt } };
}

/**
 * The wet estimate of the layers present at `at`: each layer's remaining solids
 * at its own moisture, summed. Estimated moisture is 1 − solids ÷ wet.
 */
export function estimateStock(layers: readonly LayerMoistureBasis[], at: string): StockEstimate {
  let solids = rational(BigInt(0));
  let wet: Rational | null = rational(BigInt(0));
  let basis: MoistureBasis | null = null;
  for (const layer of layers) {
    if (layer.placedAt > at || layer.remainingSolidsKg.numerator <= BigInt(0)) continue;
    solids = add(solids, layer.remainingSolidsKg);
    const known = layerSolidsFraction(layer, at);
    if (!known) { wet = null; continue; }
    if (wet) wet = add(wet, divide(layer.remainingSolidsKg, known.fraction));
    if (!basis || known.basis.at > basis.at) basis = known.basis;
  }
  const moisture = wet && wet.numerator > BigInt(0) ? toNumber(subtract(rational(BigInt(1)), divide(solids, wet))) * PERCENT : null;
  return { solidsKg: toNumber(solids), wetKg: wet ? toNumber(wet) : null, moisturePercent: moisture, basis };
}

/** A reading a posting records on one layer, with the solids the layer holds right after it. */
export interface PlannedReading { layerId: string; moisturePercent: number; solidsKg: Rational }

/**
 * The readings a planned movement records. A reading resets what it was taken
 * from: in a split bin every drawn sub-bin at its own reading; in a mix bin,
 * and for any count, every layer present, since the reading describes the whole
 * pile. A layer the movement empties has no moisture left to reset, and a zero
 * count measured none.
 */
export function planReadings(request: OutputStockRequest, plan: Pick<ReturnType<typeof planOutputStock>, 'allocations' | 'remainingLayers'>, occurredAt: string, policy: DrawPolicy = 'fifo'): PlannedReading[] {
  const remaining = new Map<string, OutputStockLayer>(plan.remainingLayers.map(layer => [layer.id, layer]));
  const held = (layerId: string) => {
    const layer = remaining.get(layerId);
    const solidsKg = layer ? layerRemainingSolidsKg(layer) : null;
    return solidsKg && solidsKg.numerator > BigInt(0) ? solidsKg : null;
  };
  const readings: PlannedReading[] = [];
  const pileReading = request.kind === 'count' ? (Number(request.wetKg) > 0 ? request.moisturePercent : undefined)
    : policy === 'pro_rata' && request.kind === 'wet' ? request.moisturePercent : undefined;
  if (request.kind === 'count' || policy === 'pro_rata') {
    if (pileReading == null) return readings;
    for (const layer of plan.remainingLayers) {
      const solidsKg = layer.placedAt <= occurredAt ? held(layer.id) : null;
      if (solidsKg) readings.push({ layerId: layer.id, moisturePercent: Number(pileReading), solidsKg });
    }
    return readings;
  }
  for (const allocation of plan.allocations) {
    const solidsKg = allocation.readingPercent == null ? null : held(allocation.layerId);
    if (solidsKg) readings.push({ layerId: allocation.layerId, moisturePercent: Number(allocation.readingPercent), solidsKg });
  }
  return readings;
}

/** Layers with a movement's readings added, taken at `occurredAt` by the posting `sequence`. */
export function withReadings(layers: readonly LayerMoistureBasis[], readings: readonly PlannedReading[], occurredAt: string, sequence: bigint): LayerMoistureBasis[] {
  return layers.map(layer => {
    const added = readings.filter(reading => reading.layerId === layer.layerId).map(reading => ({ moisturePercent: reading.moisturePercent, occurredAt, sequence }));
    return added.length ? { ...layer, readings: [...layer.readings, ...added] } : layer;
  });
}
