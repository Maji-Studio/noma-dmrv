import { GRAMS_PER_KG, add, compare, decimal, divide, grams, kilograms, multiply, rational, round, splitCumulativeGrams, subtract, type Decimal, type Rational } from './exact';

export interface OutputStockRun {
  productionRunId: string;
  establishedDryKg: Decimal;
  remainingDryKg: Decimal;
}
export interface OutputStockLayer {
  id: string;
  /** Instant the layer physically entered the bin (canonical ISO 8601 UTC), independently of recorded time. */
  placedAt: string;
  postingSequence: bigint;
  establishedDryBiocharKg: Decimal;
  ingredientDrySolidsKg: Decimal;
  remainingDryBiocharKg: Decimal;
  /** Exact physical solids balance retained independently of display gram rounding. */
  remainingSolidsKg?: Rational;
  runs: readonly OutputStockRun[];
}
export type OutputStockRequest =
  | { kind: 'wet'; wetKg: Decimal; moisturePercent: Decimal }
  | { kind: 'solids'; solidsKg: Decimal }
  | { kind: 'count'; wetKg: Decimal; moisturePercent?: Decimal }
  | { kind: 'count-solids'; solidsKg: Decimal }
  /** Split bin: sub-bins in the order they were emptied, each with its own reading, and one load weight. */
  | { kind: 'ordered'; wetKg: Decimal; sources: readonly OrderedSource[] };
export interface OrderedSource { layerId: string; moisturePercent: Decimal }
/**
 * How a removal is attributed to layers: oldest first, or, in a mix bin, from
 * every layer present in proportion to its remaining solids (ADR 0030). A split
 * bin's sub-bin order is the `ordered` request, not a policy.
 */
export type DrawPolicy = 'fifo' | 'pro_rata';
/** The policy a mix draw's allocations are saved with; the credit hold matches on it. */
export const PRO_RATA_POLICY = 'pro_rata' satisfies DrawPolicy;

/** The load weight is used up before this sub-bin; the operator unticks it. */
export class UntickSubBinError extends RangeError {
  constructor(public readonly layerId: string) { super('Load never reaches this sub-bin; untick it'); }
}
/** The last sub-bin's measured solids exceed what its records hold; a count comes first. */
export class SubBinOverdrawError extends RangeError {
  constructor(public readonly layerId: string) { super('Measured solids exceed the sub-bin'); }
}

/** Grid (per kg) a split draw's partial solids and a mix draw's shares are floored to: 1e-9 kg, one microgram. */
const SOLIDS_GRID_PER_KG = BigInt(1_000_000_000);
const gridUnits = (value: Rational) => value.numerator * SOLIDS_GRID_PER_KG / value.denominator;
function floorToGrid(value: Rational): Rational {
  return rational(gridUnits(value), SOLIDS_GRID_PER_KG);
}

/** A layer's exact remaining solids: the retained balance, or its dry biochar at the layer's biochar share. */
export function layerRemainingSolidsKg(layer: OutputStockLayer): Rational {
  const established = grams(layer.establishedDryBiocharKg);
  return layer.remainingSolidsKg ?? divide(rational(grams(layer.remainingDryBiocharKg), GRAMS_PER_KG), rational(established, established + grams(layer.ingredientDrySolidsKg)));
}

/** Only canonical ISO 8601 UTC instants (`Date#toISOString`) are accepted, so string order is time order. */
function canonicalInstant(value: string): string {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new RangeError('Invalid physical time');
  return value;
}
/** The solids fraction (1 − moisture) of a reading. */
function solidsFraction(moisturePercent: Decimal | undefined): Rational {
  const moisture = decimal(moisturePercent as Decimal);
  if (compare(moisture, rational(BigInt(100))) >= BigInt(0)) throw new RangeError('Moisture must be below 100 percent');
  return subtract(rational(BigInt(1)), divide(moisture, rational(BigInt(100))));
}
function wetSolids(wetKg: Decimal, moisturePercent: Decimal | undefined): Rational {
  return multiply(decimal(wetKg), solidsFraction(moisturePercent));
}

/**
 * Pure FIFO. Capacity is checked as an exact rational BEFORE any gram rounding.
 * Cumulative layer consumption rounds half-up, while exact physical solids
 * residuals survive every posting. Full layers and final run remainders close
 * exactly. Run weights use frozen remaining provenance, never live source data.
 * Returned layers can be passed into the next plan; callers persist allocations,
 * not a replay of this calculation. This function does not authorize a database write.
 */
export function planOutputStock(layers: readonly OutputStockLayer[], occurredAt: string, request: OutputStockRequest, policy: DrawPolicy = 'fifo') {
  const at = canonicalInstant(occurredAt);
  if (request.kind === 'ordered' && policy !== 'fifo') throw new RangeError('A mix bin has no sub-bin order');
  const ids = new Set<string>();
  const sequences = new Set<bigint>();
  const prepared = layers.map(layer => {
    const placedAt = canonicalInstant(layer.placedAt);
    if (!layer.id || ids.has(layer.id) || typeof layer.postingSequence !== 'bigint' || layer.postingSequence < BigInt(0) || sequences.has(layer.postingSequence)) throw new RangeError('Invalid or duplicate layer identity/order');
    ids.add(layer.id); sequences.add(layer.postingSequence);
    const established = grams(layer.establishedDryBiocharKg);
    const ingredients = grams(layer.ingredientDrySolidsKg);
    const remaining = grams(layer.remainingDryBiocharKg);
    if (established <= BigInt(0) || remaining > established) throw new RangeError('Invalid layer balance');
    const runIds = new Set<string>();
    const runs = layer.runs.map(run => {
      if (!run.productionRunId || runIds.has(run.productionRunId)) throw new RangeError('Duplicate or missing run');
      runIds.add(run.productionRunId);
      const initial = grams(run.establishedDryKg);
      const balance = grams(run.remainingDryKg);
      if (balance > initial) throw new RangeError('Invalid run balance');
      return { initial, balance };
    });
    if (runs.reduce((sum, r) => sum + r.initial, BigInt(0)) !== established || runs.reduce((sum, r) => sum + r.balance, BigInt(0)) !== remaining) throw new RangeError('Run provenance must sum to layer');
    const fraction = rational(established, established + ingredients);
    const capacity = layerRemainingSolidsKg(layer);
    const exactRemainingGrams = multiply(multiply(capacity, fraction), rational(GRAMS_PER_KG));
    if (capacity.numerator < BigInt(0) || capacity.denominator <= BigInt(0) ||
      compare(capacity, rational(established + ingredients, GRAMS_PER_KG)) > BigInt(0) ||
      established - round(subtract(rational(established), exactRemainingGrams)) !== remaining) {
      throw new RangeError('Exact solids balance does not match conserved dry stock');
    }
    return { layer, placedAt, established, remaining, fraction, capacity, runs };
  }).sort((a, b) => a.placedAt.localeCompare(b.placedAt) || (a.layer.postingSequence < b.layer.postingSequence ? -1 : 1));
  const eligible = prepared.filter(p => p.placedAt <= at);
  const expectedSolidsKg = eligible.reduce((sum, p) => add(sum, p.capacity), rational(BigInt(0)));
  type Prepared = (typeof prepared)[number];
  const allocations: { layerId: string; dryKg: string; solidsKg: Rational; wetShareKg: Rational | null; readingPercent: Decimal | null; runs: { productionRunId: string; dryKg: string }[] }[] = [];
  const drawn = new Map<string, OutputStockLayer>();
  /** Takes exact solids from one layer, rounding dry grams cumulatively and closing run shares. */
  const draw = (p: Prepared, solidsKg: Rational, wetShareKg: Rational | null, readingPercent: Decimal | null) => {
    const remainingSolidsKg = subtract(p.capacity, solidsKg);
    const exactRemainingDryGrams = multiply(multiply(remainingSolidsKg, p.fraction), rational(GRAMS_PER_KG));
    const remainingDryGrams = p.established - round(subtract(rational(p.established), exactRemainingDryGrams));
    const dryGrams = p.remaining - remainingDryGrams;
    const cumulativeShares = splitCumulativeGrams(p.established - remainingDryGrams, p.runs.map(run => run.initial));
    const shares = cumulativeShares.map((share, index) => share - (p.runs[index].initial - p.runs[index].balance));
    if (shares.some((share, index) => share < BigInt(0) || share > p.runs[index].balance)) {
      throw new RangeError('Run balance does not match frozen cumulative provenance');
    }
    const runs = p.layer.runs.map((run, i) => ({ productionRunId: run.productionRunId, dryKg: kilograms(shares[i]) }));
    allocations.push({ layerId: p.layer.id, dryKg: kilograms(dryGrams), solidsKg, wetShareKg, readingPercent, runs });
    drawn.set(p.layer.id, { ...p.layer, remainingSolidsKg, remainingDryBiocharKg: kilograms(remainingDryGrams), runs: p.layer.runs.map((run, i) => ({ ...run, remainingDryKg: kilograms(p.runs[i].balance - shares[i]) })) });
  };
  const count = request.kind === 'count' || request.kind === 'count-solids';
  let discrepancySolidsKg = rational(BigInt(0));
  if (request.kind === 'ordered') {
    let wetLeft = decimal(request.wetKg);
    if (wetLeft.numerator <= BigInt(0)) throw new RangeError('Draw must be positive');
    const byId = new Map(eligible.map(p => [p.layer.id, p]));
    if (!request.sources.length) throw new RangeError('Choose at least one sub-bin');
    if (new Set(request.sources.map(source => source.layerId)).size !== request.sources.length ||
      request.sources.some(source => !byId.has(source.layerId))) {
      throw new RangeError('Choose each sub-bin once from stock present at this time');
    }
    request.sources.forEach((source, index) => {
      const p = byId.get(source.layerId)!;
      if (p.capacity.numerator === BigInt(0)) throw new UntickSubBinError(source.layerId);
      const fraction = solidsFraction(source.moisturePercent);
      if (index < request.sources.length - 1) {
        // Emptied at its own reading; the load must still reach the next sub-bin.
        const wetKg = divide(p.capacity, fraction);
        wetLeft = subtract(wetLeft, wetKg);
        if (wetLeft.numerator <= BigInt(0)) throw new UntickSubBinError(request.sources[index + 1].layerId);
        draw(p, p.capacity, wetKg, source.moisturePercent);
      } else {
        const exactSolidsKg = multiply(wetLeft, fraction);
        if (compare(exactSolidsKg, p.capacity) > BigInt(0)) throw new SubBinOverdrawError(source.layerId);
        // Emptied sub-bins pass their readings into this remainder's denominator. Rounding
        // the last partial draw down to a fixed grid keeps later exact balances bounded.
        const solidsKg = compare(exactSolidsKg, p.capacity) === BigInt(0) ? p.capacity : floorToGrid(exactSolidsKg);
        draw(p, solidsKg, wetLeft, source.moisturePercent);
      }
    });
  } else {
    let measured: Rational;
    if (request.kind === 'solids' || request.kind === 'count-solids') measured = decimal(request.solidsKg);
    else if (request.kind === 'count' && decimal(request.wetKg).numerator === BigInt(0)) measured = rational(BigInt(0));
    else measured = wetSolids(request.wetKg, request.moisturePercent);
    if (!count && measured.numerator <= BigInt(0)) throw new RangeError('Draw must be positive');
    discrepancySolidsKg = count ? subtract(measured, expectedSolidsKg) : rational(BigInt(0));
    const requested = count ? subtract(expectedSolidsKg, measured) : measured;
    if (compare(requested, expectedSolidsKg) > BigInt(0)) throw new RangeError('Insufficient exact dry solids');
    let left = requested.numerator > BigInt(0) ? requested : rational(BigInt(0));
    const readingPercent = request.kind === 'wet' ? request.moisturePercent : null;
    const take = (p: Prepared, solidsKg: Rational) =>
      draw(p, solidsKg, request.kind === 'wet' ? divide(solidsKg, solidsFraction(request.moisturePercent)) : null, readingPercent);
    if (policy === 'pro_rata') {
      proRataShares(eligible.filter(p => p.capacity.numerator > BigInt(0)), left).forEach(([p, solidsKg]) => take(p, solidsKg));
    } else {
      for (const p of eligible) {
        if (left.numerator === BigInt(0)) break;
        if (p.capacity.numerator === BigInt(0)) continue;
        const solidsKg = compare(left, p.capacity) >= BigInt(0) ? p.capacity : left;
        take(p, solidsKg);
        left = subtract(left, solidsKg);
      }
    }
  }
  const remainingLayers = prepared.map(p => drawn.get(p.layer.id) ?? p.layer);
  const drawnDryGrams = allocations.reduce((sum, allocation) => sum + grams(allocation.dryKg), BigInt(0));
  if (!count && drawnDryGrams === BigInt(0)) {
    throw new RangeError('Draw is below one gram of dry biochar; increase the measured mass');
  }
  return { allocations, remainingLayers, expectedSolidsKg, discrepancySolidsKg, drawnDryKg: kilograms(drawnDryGrams) };
}

/**
 * A mix draw's solids per layer (ADR 0030). Every layer present gives in
 * proportion to what it holds. The draw's exact dry, rounded half up to the
 * gram, is apportioned as whole grams with the cumulative rule run shares use,
 * capped at what each layer holds, and every layer but the one holding most
 * takes exactly the solids of its grams at its own biochar share. That layer
 * takes the rest of the measured solids (floored to the microgram grid), so the
 * removal conserves the measured solids and its dry total is within a gram of
 * exact, with no layer rounding on its own. A draw of the whole pile takes every layer exactly;
 * layers given nothing are left out.
 */
function proRataShares<T extends { capacity: Rational; fraction: Rational; remaining: bigint }>(held: readonly T[], solidsKg: Rational): [T, Rational][] {
  const total = held.reduce((sum, p) => add(sum, p.capacity), rational(BigInt(0)));
  if (solidsKg.numerator === BigInt(0)) return [];
  if (compare(solidsKg, total) === BigInt(0)) return held.map(p => [p, p.capacity]);
  const gramsPerKg = rational(GRAMS_PER_KG);
  const exactDryGrams = held.reduce((sum, p) => add(sum, multiply(multiply(divide(multiply(solidsKg, p.capacity), total), p.fraction), gramsPerKg)), rational(BigInt(0)));
  // A layer gives at most its whole remaining grams, and never more solids than it holds.
  const caps = held.map(p => { const exact = multiply(multiply(p.capacity, p.fraction), gramsPerKg); const floor = exact.numerator / exact.denominator; return floor < p.remaining ? floor : p.remaining; });
  const capTotal = caps.reduce((sum, cap) => sum + cap, BigInt(0));
  const target = round(exactDryGrams);
  const grams = apportionCapped(target < capTotal ? target : capTotal, held.map(p => gridUnits(multiply(p.capacity, p.fraction))), caps);
  const solids = held.map((p, index) => divide(rational(grams[index]), multiply(p.fraction, gramsPerKg)));
  const rest = held.reduce((largest, p, index) => compare(p.capacity, held[largest].capacity) > BigInt(0) ? index : largest, 0);
  const others = solids.reduce((sum, value, index) => index === rest ? sum : add(sum, value), rational(BigInt(0)));
  // Floored to the grid like a split draw's last sub-bin, so the layers taking the rest keep bounded exact balances.
  const restSolids = floorToGrid(subtract(solidsKg, others));
  // The rest always fits in practice; if rounding ever leaves it out of range, fall back to exact solids shares on the grid.
  if (restSolids.numerator < BigInt(0) || compare(restSolids, held[rest].capacity) > BigInt(0)) return proRataSolidsOnGrid(held, solidsKg);
  solids[rest] = restSolids;
  return held.flatMap((p, index): [T, Rational][] => solids[index].numerator > BigInt(0) ? [[p, solids[index]]] : []);
}

/** Exact solids shares on the microgram grid, in proportion to each layer's remaining solids. */
function proRataSolidsOnGrid<T extends { capacity: Rational }>(held: readonly T[], solidsKg: Rational): [T, Rational][] {
  const weights = held.map(p => gridUnits(p.capacity));
  const available = weights.reduce((sum, weight) => sum + weight, BigInt(0));
  const units = gridUnits(solidsKg);
  const shares = splitCumulativeGrams(units < available ? units : available, weights);
  return held.flatMap((p, index): [T, Rational][] => shares[index] > BigInt(0) ? [[p, rational(shares[index], SOLIDS_GRID_PER_KG)]] : []);
}

/** Cumulative proportional apportionment with a ceiling per part; what a full part cannot take goes to the others. */
function apportionCapped(total: bigint, weights: readonly bigint[], caps: readonly bigint[]): bigint[] {
  const shares = weights.map(() => BigInt(0));
  let left = total;
  let open = weights.flatMap((weight, index) => weight > BigInt(0) && caps[index] > BigInt(0) ? [index] : []);
  while (left > BigInt(0) && open.length) {
    const split = splitCumulativeGrams(left, open.map(index => weights[index]));
    left = BigInt(0);
    open = open.filter((index, k) => {
      const room = caps[index] - shares[index];
      const given = split[k] < room ? split[k] : room;
      shares[index] += given;
      left += split[k] - given;
      return shares[index] < caps[index];
    });
  }
  return shares;
}
