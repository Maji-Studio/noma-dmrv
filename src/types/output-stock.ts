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
  physicalDate: string;
  kind: 'delivery' | 'loss' | 'count' | 'production_draw';
  wetMassKg: number;
  moisturePercent?: number | null;
  correctsMovementId?: string;
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
  estimateMoisturePercent: number | null;
  beforeEstimatedWetKg: number | null;
  afterEstimatedWetKg: number | null;
  discrepancySolidsKg: number;
  allocations: OutputStockAllocationView[];
  beforeAllocations?: OutputStockAllocationView[];
  afterAllocations?: OutputStockAllocationView[];
  /** Validation failure, such as insufficient solids, leaves the full form visible. */
  blockingMessage: string | null;
  blockers?: { entity: string; id: string; code: string }[];
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
  physicalDate: string;
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
}

export interface MatchingOutputBin {
  id: string;
  code: string;
  name: string;
  dryMassKg: number;
  recordedWetMassKg: number | null;
  /** Wet stock at each batch's recorded moisture; null when the bin's layers do not resolve. */
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
