import type { z } from 'zod';
import type { MoistureBasis } from '@/lib/output-stock/moisture-estimate';
import type { OutputDrawOrder, OutputStockMode } from '@/lib/output-stock/stock-mode';
import type { orderedSourceSchema } from '@/schemas/output-stock';
import type { SubBinIngredient } from '@/lib/output-stock/sub-bin-ingredients';
/** Serializable operator read models; exact fractions remain inside the ledger. */
export interface OutputStockAllocationView {
  layerId: string;
  code: string;
  wetMassKg: number | null;
  dryMassKg: number;
  runs: { productionRunId: string; code: string; dryMassKg: number }[];
}

export interface OutputStockPreviewInput {
  storageLocationId: string;
  facilityId: string;
  /** ISO 8601 UTC instant the event physically happened. */
  occurredAt: string;
  kind: 'delivery' | 'loss' | 'count' | 'production_draw';
  wetMassKg: number;
  moisturePercent?: number | null;
  correctsMovementId?: string;
  /** Split bins: sub-bins in the order they were emptied, each with its reading. */
  sources?: z.infer<typeof orderedSourceSchema>[];
}

export interface OutputStockPreview {
  expectedProductVersions: Record<string, number>;
  basisFingerprint: string;
  storageLocationId: string;
  binName: string;
  binCode?: string;
  formulationName?: string | null;
  lane: 'biochar' | 'product' | 'ingredient';
  dryLabel?: 'dry solids';
  wetLabel?: 'wet stock';
  beforeDryKg: number;
  afterDryKg: number;
  beforeSolidsKg: number;
  afterSolidsKg: number;
  /** Exact allocation solids converted for display; older saved previews omit it. */
  removedSolidsKg?: number;
  removedDryKg: number;
  removedWetKg: number | null;
  /** The moisture this movement's wet figures are at: the reading, or a split draw's overall 1 − solids ÷ wet. */
  movementMoisturePercent: number | null;
  /** Wet stock, wet in less wet out from each batch's last count, before and after this movement. */
  beforeEstimatedWetKg: number | null;
  afterEstimatedWetKg: number | null;
  /** New previews return null unless this draw re-estimates remaining stock. Older saved previews omit it. */
  reestimate?: {
    /** Shared draw reading, or null when re-estimated sub-bins have different readings. */
    moisturePercent: number | null;
    layers: { layerId: string; name: string; moisturePercent: number; stayWetKg: number; staySolidsKg: number }[];
    /** Whole-bin balances after the draw. */
    stayWetKg: number;
    staySolidsKg: number;
    stayDryKg: number;
  } | null;
  /** The bin's estimate before this movement: the hint beside a moisture field. */
  moistureEstimate?: OutputMoistureEstimate | null;
  /** What a count's readings reset: the same remaining stock at its previous estimate, then at the count. Removal re-estimates use reestimate. */
  moistureReset?: OutputMoistureReset | null;
  /** The bin's stock mode at this movement's time; a merged bin is split before its merge. */
  stockMode?: OutputStockMode;
  /**
   * Mix bins: posted removals timed after this entry, labelled with their
   * facility time. Their saved shares were calculated without it and stay as posted.
   */
  calculatedWithout?: { id: string; label: string; occurredAt: string }[];
  discrepancySolidsKg: number;
  allocations: OutputStockAllocationView[];
  beforeAllocations?: OutputStockAllocationView[];
  afterAllocations?: OutputStockAllocationView[];
  /** Validation failure, such as insufficient solids, leaves the full form visible. */
  blockingMessage: string | null;
  blockers?: { entity: string; id: string; code: string }[];
}

export interface OutputMoistureEstimate {
  moisturePercent: number | null;
  wetKg: number | null;
  /** Where the estimate comes from: the last count, a removal re-estimate, or the moisture recorded when the batch was added. */
  basis: MoistureBasis | null;
}

export interface OutputMoistureReset {
  /** The sub-bins the readings describe. */
  layerCodes: string[];
  before: { moisturePercent: number | null; wetKg: number | null };
  after: { moisturePercent: number | null; wetKg: number | null };
}

export interface OutputStockPostInput extends OutputStockPreviewInput {
  expectedProductVersions: Record<string, number>;
  basisFingerprint: string;
  idempotencyKey: string;
  reason: string;
}

export interface OutputStockHistoryEntry {
  /** Null while this loss or delivery is latest; omitted for other kinds. */
  editLockedReason?: string | null;
  id: string;
  kind: string;
  eventKind?: 'delivery' | 'loss' | 'count' | 'production_draw';
  /** ISO 8601 UTC instant the event physically happened. */
  occurredAt: string;
  recordedAt: string;
  actorName: string | null;
  reason: string;
  wetMassKg: number | null;
  moisturePercent: number | null;
  dryMassKg: number;
  /**
   * Movements retain their saved posting-order balance. Intakes (and their
   * placement reversals) use physical order. Live intakes exclude cancelled
   * pairs; cancelled entries retain the audit balance including those pairs.
   */
  beforeDryKg: number;
  afterDryKg: number;
  correctsMovementId: string | null;
  deliveryId: string | null;
  /** The form this movement came from, when it has one. */
  source?: { entity: 'productionRun' | 'biocharProduct' | 'delivery' | 'application'; id: string };
  /** Wet change in the current balance model; intakes keep recorded wet. Null means unknown. */
  wetDeltaKg?: number | null;
  /** Recomputed wet balance after this posting, for recovering an unknown replay figure. */
  currentAfterWetKg?: number | null;
  /** Frozen preview wet change, retained for row details when the current estimate changes. */
  savedWetDeltaKg?: number | null;
  /** Frozen solids change; null means the solids basis is unresolved. */
  solidsDeltaKg?: number | null;
  /** Movements: the frozen wet and solids balance right after this one, which re-base a replay whose figure turned unknown. */
  afterWetKg?: number | null;
  afterSolidsKg?: number | null;
  /** Product bins: the ingredient solids this entry moved, by material, signed like the stock change. */
  ingredientSolidsDeltas?: SubBinIngredient[];
  allocations: OutputStockAllocationView[];
  /** Split draws: the sub-bins and readings the entry was posted with. */
  sources?: { layerId: string; moisturePercent: number }[];
  /** "Moisture updated" entries: the count whose readings reset the estimate, and the change. */
  measuredByMovementId?: string;
  moistureReset?: OutputMoistureReset;
}

/** One entry in a sub-bin's short history, worded for the operator. */
export interface SubBinMovement {
  id: string;
  kind: 'added' | 'removed' | 'loss' | 'count';
  /** ISO 8601 UTC instant the event physically happened. */
  occurredAt: string;
  wetMassKg: number | null;
  dryMassKg: number;
}

/** A batch or run still held in a split bin, as the picker and the bin's cards show it. */
export interface OutputSubBin {
  layerId: string;
  code: string;
  /** ISO 8601 UTC instant the batch or run entered the bin. */
  placedAt: string;
  dryMassKg: number;
  solidsKg: number;
  /**
   * The sub-bin's wet stock, wet in less wet out from its last count. Null for
   * a mix-bin layer (a mix pile has one moisture, in the bin's totals) and for
   * a split layer whose recorded wet is missing, zero or unparseable until a
   * count supplies a reading. subBinFigures uses this layer figure;
   * pileFigures instead requires the pile's wet total.
   */
  wetEstimateKg: number | null;
  moisturePercent: number | null;
  basis: MoistureBasis | null;
  /** Newest first, at most `SUB_BIN_RECENT_MOVEMENTS`. */
  recentMovements: SubBinMovement[];
  /** `solidsKg` less `dryMassKg`, split by ingredient in the product's saved shares; empty for pure biochar. */
  ingredients: SubBinIngredient[];
}

export interface OutputSubBins {
  stockMode: OutputStockMode;
  /** The bin's default draw order: where the picker starts unless the operator changes it. */
  drawOrder: OutputDrawOrder;
  /** Split bins follow `drawOrder`; mix bins keep chronological batch display. */
  subBins: OutputSubBin[];
}

export interface OutputSubBinsInput {
  storageLocationId: string;
  facilityId: string;
  /** The entry's time. Omitted means now, taken on the server once the read's snapshot is fixed. */
  occurredAt?: string;
  /** A correction reads the sub-bins as they were before the entry it replaces. */
  correctsMovementId?: string;
  kind?: OutputStockPreviewInput['kind'];
}

export interface MatchingOutputBin {
  id: string;
  code: string;
  name: string;
  /** Null when the bin's layers do not resolve. */
  dryMassKg: number | null;
  /** Wet stock, wet in less wet out from each batch's last count; null when the bin's layers do not resolve. */
  estimatedWetMassKg: number | null;
}

/** Ingredient wet stock remains usable when its dry estimate is unavailable. */
export type OutputStockBalanceView = Omit<OutputStockAllocationView, 'dryMassKg'> & { dryMassKg: number | null };
export type IngredientStockPreview = Omit<OutputStockPreview,
  'beforeDryKg' | 'afterDryKg' | 'removedDryKg' | 'beforeSolidsKg' | 'afterSolidsKg' | 'beforeAllocations' | 'afterAllocations'
> & {
  lane: 'ingredient';
  beforeDryKg: number | null;
  afterDryKg: number | null;
  removedDryKg: number | null;
  beforeSolidsKg: number | null;
  afterSolidsKg: number | null;
  beforeAllocations?: OutputStockBalanceView[];
  afterAllocations?: OutputStockBalanceView[];
};
export type AffectedStockPreview = OutputStockPreview | IngredientStockPreview;
