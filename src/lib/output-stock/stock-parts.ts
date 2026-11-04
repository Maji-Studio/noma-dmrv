/** Display-only stock composition. Never use these parts to authorize a draw. */
import { STOCK_PART_MIN_KG } from '@/config/output-stock';
import type { OutputSubBin } from '@/types/output-stock';

export interface StockFigures {
  dryKg: number;
  solidsKg: number | null;
  wetKg: number | null;
  ingredients: ReadonlyMap<string, number>;
}

export type StockPart = { kind: 'water' | 'dry'; kg: number }
  | { kind: 'ingredient'; name: string | null; kg: number };

export interface StockParts {
  dryBiocharKg: number;
  ingredientSolidsKg: number | null;
  waterKg: number | null;
  wetKg: number | null;
  sizeKg: number;
  rows: StockPart[];
}

/** Unknown or physically inconsistent stock has no honest water figure; keep its recorded wet mass. */
export function stockWaterKg(figures: Pick<StockFigures, 'wetKg' | 'solidsKg'>): number | null {
  if (figures.wetKg === null || figures.solidsKg === null || figures.wetKg < figures.solidsKg - STOCK_PART_MIN_KG) return null;
  return Math.max(figures.wetKg - figures.solidsKg, 0);
}

/** Unrounded figures; only layout rows use the minimum displayed part size. */
export function stockParts(figures: StockFigures): StockParts {
  const ingredientSolidsKg = figures.solidsKg === null ? null : Math.max(figures.solidsKg - figures.dryKg, 0);
  const waterKg = stockWaterKg(figures);
  const rows: StockPart[] = [];
  if (waterKg !== null && waterKg >= STOCK_PART_MIN_KG) rows.push({ kind: 'water', kg: waterKg });
  let namedKg = 0;
  for (const [name, kg] of figures.ingredients) {
    if (kg < STOCK_PART_MIN_KG) continue;
    rows.push({ kind: 'ingredient', name, kg });
    namedKg += kg;
  }
  if (ingredientSolidsKg !== null && ingredientSolidsKg - namedKg >= STOCK_PART_MIN_KG) {
    rows.push({ kind: 'ingredient', name: null, kg: ingredientSolidsKg - namedKg });
  }
  rows.push({ kind: 'dry', kg: figures.dryKg });
  return { dryBiocharKg: figures.dryKg, ingredientSolidsKg, waterKg, wetKg: figures.wetKg,
    sizeKg: waterKg !== null ? figures.wetKg! : figures.solidsKg ?? figures.dryKg, rows };
}

type LayerFigures = Pick<OutputSubBin, 'dryMassKg' | 'solidsKg' | 'ingredients'>;

export function subBinFigures(subBin: LayerFigures & Pick<OutputSubBin, 'wetEstimateKg'>): StockFigures {
  return pileFigures([subBin], subBin.wetEstimateKg);
}

/** A mix pile takes wet mass from the pile, never from its accounting layers. */
export function pileFigures(layers: readonly LayerFigures[], pileWetKg: number | null): StockFigures {
  const ingredients = new Map<string, number>();
  let dryKg = 0;
  let solidsKg = 0;
  for (const layer of layers) {
    dryKg += layer.dryMassKg;
    solidsKg += layer.solidsKg;
    for (const part of layer.ingredients) ingredients.set(part.name, (ingredients.get(part.name) ?? 0) + part.solidsKg);
  }
  return { dryKg, solidsKg, wetKg: pileWetKg, ingredients };
}
