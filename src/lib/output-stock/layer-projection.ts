/**
 * Output-bin layers from saved rows, with no database access. Readers fetch
 * rows and call these; every rule about which saved row reduces a layer lives
 * here once, so it is tested with plain rows (ADR 0029).
 */
import { SafeError } from '@/lib/errors';
import { add, decimal, grams, GRAMS_PER_KG, kilograms, rational, readRational, subtract, type Decimal, type Rational } from './exact';
import type { LayerMoistureBasis } from './moisture-estimate';
import { planOutputStock, type OutputStockLayer } from './planner';

/** A layer's saved facts are incomplete; readers show the bin as unavailable. */
export class UnresolvedOutputStockError extends SafeError {}

/** One saved output-stock allocation with its per-run split, as the allocation projection returns it. */
export interface AllocationEffectRow {
  allocation: {
    id: string;
    productionRunId: string | null;
    biocharProductId: string | null;
    targetBiocharProductId: string | null;
    dryMassKg: string;
    basisSnapshot: Record<string, unknown>;
  };
  run: { productionRunId: string; dryMassKg: string } | null;
}

/** A product's draw from a production run, saved when the product was made. */
export interface SourceDrawRow { productId: string; runId: string; dryKg: string }

export interface CompletedRunRow { id: string; endTime: Date | null; dryKg: string | null; postingSequence: bigint }

export interface ProductRow { id: string; placedAt: Date | null; postingSequence: bigint; composition: unknown }

export interface IngredientSnapshotRow { biocharProductId: string; formulationIngredientId: string; drySolidsKg: string }

function gramsSigned(value: string): bigint {
  return value.startsWith('-') ? -grams(value.slice(1)) : grams(value);
}

/** Each allocation once: the projection repeats an allocation per run it split across. */
function uniqueAllocations(effects: readonly AllocationEffectRow[]): AllocationEffectRow['allocation'][] {
  return [...new Map(effects.map(effect => [effect.allocation.id, effect.allocation])).values()];
}

function isResolvedDryKg(dryKg: string | null): dryKg is string {
  return dryKg != null && Number.isFinite(Number(dryKg)) && Number(dryKg) > 0;
}

/**
 * A biochar bin's layers: one per completed run. A product draw with ledger
 * allocations is counted from the ledger; its source snapshot then names the
 * same draw, so it is skipped. `excludeUnresolvedRunId` drops the one
 * unresolved run a repair is replacing, and only while nothing drew from it.
 */
export function projectBiocharLayers(rows: { runs: readonly CompletedRunRow[]; sources: readonly SourceDrawRow[]; effects: readonly AllocationEffectRow[] }, options: { excludeUnresolvedRunId?: string } = {}): OutputStockLayer[] {
  const effects = uniqueAllocations(rows.effects);
  const postedProducts = new Set(effects.flatMap(e => e.targetBiocharProductId ? [e.targetBiocharProductId] : []));
  return rows.runs.filter(run => {
    if (run.id !== options.excludeUnresolvedRunId) return true;
    if (run.endTime && isResolvedDryKg(run.dryKg)) throw new SafeError('Only unresolved production stock can be excluded for repair');
    if (rows.sources.some(source => source.runId === run.id) || rows.effects.some(effect => effect.run?.productionRunId === run.id || effect.allocation.productionRunId === run.id)) {
      throw new SafeError('Production stock has downstream allocations and cannot be excluded for repair');
    }
    return false;
  }).map(run => {
    if (!run.endTime || !isResolvedDryKg(run.dryKg)) throw new UnresolvedOutputStockError('Production dry mass or completion date is unresolved. Complete the production run mass and date.');
    const sourceDraw = rows.sources.filter(s => s.runId === run.id && !postedProducts.has(s.productId)).reduce((sum, s) => sum + grams(s.dryKg), BigInt(0));
    const runEffects = effects.filter(e => e.productionRunId === run.id);
    const ledgerDraw = runEffects.reduce((sum, e) => sum + gramsSigned(e.dryMassKg), BigInt(0));
    const consumedSolidsKg = runEffects.reduce((sum, effect) => add(sum, readRational(effect.basisSnapshot.solidsKg)), rational(sourceDraw, GRAMS_PER_KG));
    const remainingDryBiocharKg = kilograms(grams(run.dryKg) - sourceDraw - ledgerDraw);
    return { id: run.id, placedAt: run.endTime.toISOString(), postingSequence: run.postingSequence, establishedDryBiocharKg: run.dryKg,
      ingredientDrySolidsKg: '0.000', remainingDryBiocharKg,
      remainingSolidsKg: subtract(rational(grams(run.dryKg), GRAMS_PER_KG), consumedSolidsKg),
      runs: [{ productionRunId: run.id, establishedDryKg: run.dryKg, remainingDryKg: remainingDryBiocharKg }] };
  });
}

/**
 * A product bin's layers: one per product, from its frozen source-run draws
 * and ingredient snapshots. Every positive ingredient line needs exactly one
 * snapshot; anything else is unresolved.
 */
export function projectProductLayers(rows: { products: readonly ProductRow[]; sources: readonly SourceDrawRow[]; ingredients: readonly IngredientSnapshotRow[]; effects: readonly AllocationEffectRow[] }): OutputStockLayer[] {
  return rows.products.map(product => {
    if (!product.placedAt) throw new UnresolvedOutputStockError('Product placement time is unresolved');
    const snapshotIngredients = rows.ingredients.filter(i => i.biocharProductId === product.id);
    const composition = (product.composition ?? {}) as { ingredients?: { formulationIngredientId: string; massKg: number }[] };
    const ingredientLines = composition.ingredients ?? [];
    if (ingredientLines.some(i => !Number.isFinite(i.massKg) || i.massKg < 0)) throw new UnresolvedOutputStockError('Ingredient dry solids are unresolved');
    const positiveIngredients = ingredientLines.filter(i => i.massKg > 0);
    if (positiveIngredients.length !== snapshotIngredients.length || positiveIngredients.some(line =>
      snapshotIngredients.filter(snapshot => snapshot.formulationIngredientId === line.formulationIngredientId).length !== 1,
    )) throw new UnresolvedOutputStockError('Ingredient dry solids are unresolved');
    const layerEffects = rows.effects.filter(e => e.allocation.biocharProductId === product.id);
    const allocations = uniqueAllocations(layerEffects);
    const runs = rows.sources.filter(s => s.productId === product.id).map(source => ({ productionRunId: source.runId, establishedDryKg: source.dryKg,
      remainingDryKg: kilograms(grams(source.dryKg) - layerEffects.filter(e => e.run?.productionRunId === source.runId).reduce((sum, e) => sum + gramsSigned(e.run!.dryMassKg), BigInt(0))) }));
    const established = runs.reduce((sum, r) => sum + grams(r.establishedDryKg), BigInt(0));
    const ingredientGrams = snapshotIngredients.reduce((sum, i) => sum + grams(i.drySolidsKg), BigInt(0));
    const consumedSolidsKg = allocations.reduce((sum, effect) => add(sum, readRational(effect.basisSnapshot.solidsKg)), rational(BigInt(0)));
    return { id: product.id, placedAt: product.placedAt.toISOString(), postingSequence: product.postingSequence, establishedDryBiocharKg: kilograms(established),
      ingredientDrySolidsKg: kilograms(ingredientGrams),
      remainingSolidsKg: subtract(rational(established + ingredientGrams, GRAMS_PER_KG), consumedSolidsKg),
      remainingDryBiocharKg: kilograms(established - allocations.reduce((sum, e) => sum + gramsSigned(e.dryMassKg), BigInt(0))), runs };
  });
}

/**
 * The two dry figures a bin has at `at`, named apart because they answer
 * different questions:
 * - `allLayersDryKg` counts every layer, including ones placed after `at`.
 *   Guards use it so a future receipt is never drawn twice or archived away.
 * - `availableDryKg` counts only layers placed at or before `at`: what an
 *   operator can draw then.
 * Validating the layers through a closure plan also rejects broken invariants.
 */
export function outputStockBalance(layers: readonly OutputStockLayer[], at: string): { allLayersDryKg: string; availableDryKg: string; expectedSolidsKg: Rational } {
  const { expectedSolidsKg } = planOutputStock(layers, at, { kind: 'count', wetKg: 0 });
  const sum = (selected: readonly OutputStockLayer[]) => kilograms(selected.reduce((total, layer) => total + grams(layer.remainingDryBiocharKg), BigInt(0)));
  return { allLayersDryKg: sum(layers), availableDryKg: sum(layers.filter(layer => layer.placedAt <= at)), expectedSolidsKg };
}

/** A count's moisture reading on a layer, with the solids it left and the posting order of its movement. */
export interface MoistureReadingRow { layerId: string; movementId: string; moisturePercent: number; solidsBasisKg: unknown; occurredAt: Date; sequence: bigint }

/** The wet mass one posted allocation took from a layer, with its posting order; null when it took none (a count). */
export interface WetRemovalRow { layerId: string; movementId: string; wetMassKg: string | null; reversesAllocationId: string | null; sequence: bigint }

/**
 * The posting order of a product draw saved before the ledger. Every count is
 * a ledger movement posted after it, and `projectBiocharLayers` subtracts it
 * from the run layer unconditionally, so it precedes every posted movement.
 */
export const BEFORE_LEDGER_SEQUENCE = BigInt(0);

const WET_KG_PATTERN = /^\d+(\.\d+)?$/;

/**
 * What each layer's wet mass and moisture are known from: the wet mass it
 * entered the bin with, every count reading on it, and the wet mass every
 * removal took. A corrected movement and its reversal both drop out, so the
 * replacement alone counts.
 */
export function projectMoistureBases(layers: readonly OutputStockLayer[], rows: { recordedWetKg: ReadonlyMap<string, string | null>; readings: readonly MoistureReadingRow[]; removals: readonly WetRemovalRow[]; reversedMovementIds: ReadonlySet<string> }): LayerMoistureBasis[] {
  return layers.map(layer => {
    const wet = rows.recordedWetKg.get(layer.id);
    const recordedWetKg: Rational | null = wet == null || !WET_KG_PATTERN.test(wet) ? null : decimal(wet as Decimal);
    return {
      layerId: layer.id, placedAt: layer.placedAt, remainingSolidsKg: layer.remainingSolidsKg!,
      recorded: recordedWetKg ? { solidsKg: rational(grams(layer.establishedDryBiocharKg) + grams(layer.ingredientDrySolidsKg), GRAMS_PER_KG), wetKg: recordedWetKg } : null,
      readings: rows.readings.filter(reading => reading.layerId === layer.id && !rows.reversedMovementIds.has(reading.movementId))
        .map(reading => ({ moisturePercent: reading.moisturePercent, solidsKg: readRational(reading.solidsBasisKg), occurredAt: reading.occurredAt.toISOString(), sequence: reading.sequence })),
      removals: rows.removals.filter(removal => removal.layerId === layer.id && removal.wetMassKg != null && !removal.reversesAllocationId && !rows.reversedMovementIds.has(removal.movementId))
        .map(removal => ({ wetKg: decimal(removal.wetMassKg as Decimal), sequence: removal.sequence })),
    };
  });
}
