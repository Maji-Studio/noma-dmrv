/**
 * What an output bin holds at one instant, from layers and moisture bases
 * already read, with no database access. The sub-bin picker and the stock
 * read both project through here, so they agree. Figures stay exact; a
 * caller converts them once (stock-precision.ts).
 */
import { add, GRAMS_PER_KG, grams, rational, type Rational } from './exact';
import { outputStockBalance, UnresolvedOutputStockError, type UnresolvedStockReason } from './layer-projection';
import { estimateStockExact, type LayerMoistureBasis, type MoistureBasis } from './moisture-estimate';
import type { OutputStockLayer } from './planner';
import type { OutputStockMode } from './stock-mode';

export type OutputBinStockLayerKind = 'production_run' | 'biochar_product';

/** The bin a stock read answers for. */
export interface OutputBinStockFacts {
  storageLocationId: string;
  code: string;
  type: 'biochar_bin' | 'product_bin';
  facilityId: string;
  /** Canonical ISO instant, or null for a live bin. */
  archivedAt: string | null;
  /** The formulation a product bin has claimed; null for a biochar bin. */
  formulationId: string | null;
}

/** One held layer. A mix bin's layers carry no wet mass or moisture of their own (ADR 0030). */
export interface OutputSubBinStock<Code = string> {
  layerId: string;
  layerKind: OutputBinStockLayerKind;
  code: Code;
  placedAt: string;
  dryBiocharKg: Rational;
  solidsKg: Rational;
  estimatedWetKg: Rational | null;
  estimatedMoisturePercent: Rational | null;
  moistureBasis: MoistureBasis | null;
}

/** Every held layer together: for a mix bin, the pile. */
export interface OutputBinStockTotals {
  dryBiocharKg: Rational;
  solidsKg: Rational;
  estimatedWetKg: Rational | null;
  estimatedMoisturePercent: Rational | null;
  moistureBasis: MoistureBasis | null;
}

interface OutputBinStockHeader { bin: OutputBinStockFacts; stockMode: OutputStockMode }
export type ResolvedOutputBinStock<Code = string> = OutputBinStockHeader & { status: 'resolved'; unresolvedReason: null; totals: OutputBinStockTotals; subBins: OutputSubBinStock<Code>[] };
export type UnresolvedOutputBinStock = OutputBinStockHeader & { status: 'unresolved'; unresolvedReason: UnresolvedStockReason; totals: null; subBins: [] };
export type OutputBinStock<Code = string> = ResolvedOutputBinStock<Code> | UnresolvedOutputBinStock;

export interface OutputBinStockInput {
  bin: OutputBinStockFacts;
  /** The mode in force at `at`. */
  stockMode: OutputStockMode;
  /** Canonical ISO evaluation instant. */
  at: string;
  layers: readonly OutputStockLayer[];
  bases: readonly LayerMoistureBasis[];
  /** Run or product code per layer id. */
  codes: ReadonlyMap<string, string>;
}

type OrderedLayer = Pick<OutputStockLayer, 'id' | 'placedAt' | 'postingSequence'>;

/**
 * Oldest first: placement, then posting sequence, then layer id. Valid layers
 * never tie on sequence (the planner refuses duplicates); the id makes the
 * order total regardless.
 */
export function compareStockLayers(a: OrderedLayer, b: OrderedLayer): number {
  if (a.placedAt !== b.placedAt) return a.placedAt < b.placedAt ? -1 : 1;
  if (a.postingSequence !== b.postingSequence) return a.postingSequence < b.postingSequence ? -1 : 1;
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1;
}

export type ResolvedStockLayers = { status: 'resolved'; layers: OutputStockLayer[] } | { status: 'unresolved'; error: UnresolvedOutputStockError };

/**
 * A bin's layers, validated through the planner at `at` and sorted, or the
 * reason they do not resolve. Only unresolved stock is caught; a broken
 * invariant (duplicate posting sequences, a balance that does not conserve)
 * propagates as the failure it is.
 */
export function resolveStockLayers(project: () => OutputStockLayer[], at: string): ResolvedStockLayers {
  let layers: OutputStockLayer[];
  try {
    layers = project();
  } catch (error) {
    if (error instanceof UnresolvedOutputStockError) return { status: 'unresolved', error };
    throw error;
  }
  outputStockBalance(layers, at);
  return { status: 'resolved', layers: [...layers].sort(compareStockLayers) };
}

/** The answer for a bin whose layers do not resolve: no figures at all. */
export function unresolvedOutputBinStock(bin: OutputBinStockFacts, stockMode: OutputStockMode, reason: UnresolvedStockReason): UnresolvedOutputBinStock {
  return { bin, stockMode, status: 'unresolved', unresolvedReason: reason, totals: null, subBins: [] };
}

const ZERO = rational(BigInt(0));
const exactKg = (kg: OutputStockLayer['remainingDryBiocharKg']) => rational(grams(kg), GRAMS_PER_KG);
const isHeld = (layer: OutputStockLayer, at: string) => layer.placedAt <= at && (layer.remainingSolidsKg?.numerator ?? BigInt(0)) > BigInt(0);

/**
 * The layers held at `at` (placed by then and still holding solids), oldest
 * first, each with its exact dry biochar, solids and wet estimate, and the
 * totals across them. A layer without a code gets null; the caller decides
 * whether that is a fallback or a failure.
 */
export function projectOutputBinStock(input: OutputBinStockInput): ResolvedOutputBinStock<string | null> {
  const held = input.layers.filter(layer => isHeld(layer, input.at)).sort(compareStockLayers);
  const basisOf = new Map(input.bases.map(basis => [basis.layerId, basis]));
  const heldBases = held.flatMap(layer => basisOf.get(layer.id) ?? []);
  const layerKind: OutputBinStockLayerKind = input.bin.type === 'product_bin' ? 'biochar_product' : 'production_run';
  const subBins = held.map((layer): OutputSubBinStock<string | null> => {
    const basis = input.stockMode === 'split' ? basisOf.get(layer.id) : undefined;
    const estimate = basis ? estimateStockExact([basis], input.at) : null;
    return { layerId: layer.id, layerKind, code: input.codes.get(layer.id) ?? null, placedAt: layer.placedAt,
      dryBiocharKg: exactKg(layer.remainingDryBiocharKg), solidsKg: layer.remainingSolidsKg!,
      estimatedWetKg: estimate?.wetKg ?? null, estimatedMoisturePercent: estimate?.moisturePercent ?? null, moistureBasis: estimate?.basis ?? null };
  });
  // A held layer without a moisture basis leaves the bin's wet mass unknown, as a basis without wet mass does.
  // An empty bin holds 0 kg wet with no moisture, as the bins list shows it.
  const pile = heldBases.length === held.length ? estimateStockExact(heldBases, input.at) : null;
  const totals: OutputBinStockTotals = {
    dryBiocharKg: subBins.reduce((sum, subBin) => add(sum, subBin.dryBiocharKg), ZERO),
    solidsKg: subBins.reduce((sum, subBin) => add(sum, subBin.solidsKg), ZERO),
    estimatedWetKg: pile?.wetKg ?? null,
    estimatedMoisturePercent: pile?.moisturePercent ?? null,
    moistureBasis: pile?.basis ?? null,
  };
  return { bin: input.bin, stockMode: input.stockMode, status: 'resolved', unresolvedReason: null, totals, subBins };
}
