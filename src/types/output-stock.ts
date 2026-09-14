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
  lane: 'biochar' | 'product';
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
}
