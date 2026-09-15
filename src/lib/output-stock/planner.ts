import { GRAMS_PER_KG, add, compare, decimal, divide, grams, kilograms, multiply, rational, round, splitCumulativeGrams, subtract, type Decimal, type Rational } from './exact';

export interface OutputStockRun {
  productionRunId: string;
  establishedDryKg: Decimal;
  remainingDryKg: Decimal;
}
export interface OutputStockLayer {
  id: string;
  /** Physical calendar date, independently of recorded time. */
  physicalDate: string;
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
  | { kind: 'count-solids'; solidsKg: Decimal };

function validateDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new RangeError('Invalid physical date');
  }
}
function wetSolids(wetKg: Decimal, moisturePercent: Decimal | undefined): Rational {
  const moisture = decimal(moisturePercent as Decimal);
  if (compare(moisture, rational(BigInt(100))) >= BigInt(0)) throw new RangeError('Moisture must be below 100 percent');
  return multiply(decimal(wetKg), subtract(rational(BigInt(1)), divide(moisture, rational(BigInt(100)))));
}

/**
 * Pure FIFO. Capacity is checked as an exact rational BEFORE any gram rounding.
 * Cumulative layer consumption rounds half-up, while exact physical solids
 * residuals survive every posting. Full layers and final run remainders close
 * exactly. Run weights use frozen remaining provenance, never live source data.
 * Returned layers can be passed into the next plan; callers persist allocations,
 * not a replay of this calculation. This function does not authorize a database write.
 */
export function planOutputStock(layers: readonly OutputStockLayer[], physicalDate: string, request: OutputStockRequest) {
  validateDate(physicalDate);
  const ids = new Set<string>();
  const sequences = new Set<bigint>();
  const prepared = layers.map(layer => {
    validateDate(layer.physicalDate);
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
    const capacity = layer.remainingSolidsKg ?? divide(rational(remaining, GRAMS_PER_KG), fraction);
    const exactRemainingGrams = multiply(multiply(capacity, fraction), rational(GRAMS_PER_KG));
    if (capacity.numerator < BigInt(0) || capacity.denominator <= BigInt(0) ||
      compare(capacity, rational(established + ingredients, GRAMS_PER_KG)) > BigInt(0) ||
      established - round(subtract(rational(established), exactRemainingGrams)) !== remaining) {
      throw new RangeError('Exact solids balance does not match conserved dry stock');
    }
    return { layer, established, remaining, fraction, capacity, runs };
  }).sort((a, b) => a.layer.physicalDate.localeCompare(b.layer.physicalDate) || (a.layer.postingSequence < b.layer.postingSequence ? -1 : 1));
  const eligible = prepared.filter(p => p.layer.physicalDate <= physicalDate);
  const expectedSolidsKg = eligible.reduce((sum, p) => add(sum, p.capacity), rational(BigInt(0)));
  const count = request.kind === 'count' || request.kind === 'count-solids';
  let measured: Rational;
  if (request.kind === 'solids' || request.kind === 'count-solids') measured = decimal(request.solidsKg);
  else if (request.kind === 'count' && decimal(request.wetKg).numerator === BigInt(0)) measured = rational(BigInt(0));
  else measured = wetSolids(request.wetKg, request.moisturePercent);
  if (!count && measured.numerator <= BigInt(0)) throw new RangeError('Draw must be positive');
  const discrepancySolidsKg = count ? subtract(measured, expectedSolidsKg) : rational(BigInt(0));
  const requested = count ? subtract(expectedSolidsKg, measured) : measured;
  if (compare(requested, expectedSolidsKg) > BigInt(0)) throw new RangeError('Insufficient exact dry solids');
  let left = requested.numerator > BigInt(0) ? requested : rational(BigInt(0));
  const allocations = [];
  const remainingLayers: OutputStockLayer[] = [];
  for (const p of prepared) {
    if (p.layer.physicalDate > physicalDate || left.numerator === BigInt(0) || p.capacity.numerator === BigInt(0)) { remainingLayers.push(p.layer); continue; }
    const solidsKg = compare(left, p.capacity) >= BigInt(0) ? p.capacity : left;
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
    const wetShareKg = request.kind === 'wet' ? divide(solidsKg,
      subtract(rational(BigInt(1)), divide(decimal(request.moisturePercent), rational(BigInt(100))))) : null;
    allocations.push({ layerId: p.layer.id, dryKg: kilograms(dryGrams), solidsKg, wetShareKg, runs });
    remainingLayers.push({ ...p.layer, remainingSolidsKg, remainingDryBiocharKg: kilograms(remainingDryGrams), runs: p.layer.runs.map((run, i) => ({ ...run, remainingDryKg: kilograms(p.runs[i].balance - shares[i]) })) });
    left = subtract(left, solidsKg);
  }
  const drawnDryGrams = allocations.reduce((sum, allocation) => sum + grams(allocation.dryKg), BigInt(0));
  if (!count && drawnDryGrams === BigInt(0)) {
    throw new RangeError('Draw is below one gram of dry biochar; increase the measured mass');
  }
  return { allocations, remainingLayers, expectedSolidsKg, discrepancySolidsKg, drawnDryKg: kilograms(drawnDryGrams) };
}
