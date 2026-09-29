import type { z } from 'zod';
import type { MoistureBasis } from '@/lib/output-stock/moisture-estimate';
import type { orderedSourceSchema } from '@/schemas/output-stock';
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
  removedDryKg: number;
  removedWetKg: number | null;
  /** The moisture this movement's wet figures are at: the reading, or a split draw's overall 1 − solids ÷ wet. */
  movementMoisturePercent: number | null;
  /** Wet stock estimated from each batch's latest reading, before and after this movement's readings. */
  beforeEstimatedWetKg: number | null;
  afterEstimatedWetKg: number | null;
  /** The bin's estimate before this movement: the hint beside a moisture field. */
  moistureEstimate?: OutputMoistureEstimate | null;
  /** What this movement's readings reset: the same remaining stock at its previous estimate, then at the reading. */
  moistureReset?: OutputMoistureReset | null;
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
  /** Where the estimate comes from: the latest reading, or the moisture recorded when the batch was added. */
  basis: MoistureBasis | null;
}

export interface OutputMoistureReset {
  /** The sub-bins the readings describe. */
  layerCodes: string[];
  before: { moisturePercent: number | null; wetKg: number | null };
  after: { moisturePercent: number | null; wetKg: number | null };
}

export interface OutputStockPostInput extends OutputStockPreviewInput {
  basisFingerprint: string;
  idempotencyKey: string;
  reason: string;
}

export interface OutputStockHistoryEntry {
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
  beforeDryKg: number;
  afterDryKg: number;
  correctsMovementId: string | null;
  deliveryId: string | null;
  allocations: OutputStockAllocationView[];
  /** Split draws: the sub-bins and readings the entry was posted with. */
  sources?: { layerId: string; moisturePercent: number }[];
  /** "Moisture updated" entries: the movement whose readings reset the estimate, and the change. */
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
  /** Wet stock at the sub-bin's latest moisture; null when nothing dates it. */
  wetEstimateKg: number | null;
  moisturePercent: number | null;
  basis: MoistureBasis | null;
  /** Newest first, at most `SUB_BIN_RECENT_MOVEMENTS`. */
  recentMovements: SubBinMovement[];
}

export interface OutputSubBins {
  stockMode: 'split' | 'mix';
  /** Oldest first: the order a draw takes them in unless the operator changes it. */
  subBins: OutputSubBin[];
}

export interface OutputSubBinsInput {
  storageLocationId: string;
  facilityId: string;
  occurredAt: string;
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
  /** Wet stock at each batch's latest reading; null when the bin's layers do not resolve. */
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
