/**
 * Shared types for the production-runs data-access layer.
 */

import type { ProductionRun, Sample } from "@/db/schema";
import type { ProductionRunStatus } from "@/lib/production-runs/lifecycle";

export interface ProductionRunFeedstockWithDetails {
  id: string;
  feedstockId: string;
  wetMassUsedKg: number;
  feedstockCode: string | null;
  feedstockTypeName: string | null;
}

export interface ProductionRunFeedstockDrawWithDetails {
  id: string;
  storageLocationId: string;
  wetMassKg: number;
  storageLocationCode: string;
  storageLocationName: string;
  feedstockTypeId: string | null;
  feedstockTypeName: string | null;
}

export interface ProductionRunWithRelations {
  id: string;
  code: string;
  facilityId: string;
  date: string;
  status: ProductionRunStatus;
  cancellationReason: string | null;
  startTime: Date;
  // NULL = the run has started but not ended yet (an "open" run). #259.
  endTime: Date | null;
  reactorId: string;
  operatorId: string | null;
  feedingRateKgHr: number | null;
  residenceTimeMinutes: number | null;
  dieselOperationLiters: number | null;
  dieselGensetLiters: number | null;
  preprocessingFuelLiters: number | null;
  electricityKwh: number | null;
  biocharOutputKg: number | null;
  biocharMoisturePercent: number | null;
  biocharDryMassKg: number | null;
  biocharStorageLocationId: string | null;
  feedstockStorageLocationId: string | null;
  feedstockWetMassKg: number | null;
  feedstockMoisturePercent: number | null;
  feedstockMassDryKg: number | null;
  /** True only when an uploaded sensor-data document is saved for this run. */
  hasReadingsFile: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  facilityCode: string | null;
  facilityName: string | null;
  reactorCode: string | null;
  reactorIdentifier: string | null;
  operatorName: string | null;
  biocharStorageLocationCode: string | null;
  biocharStorageLocationName: string | null;
  feedstockStorageLocationCode: string | null;
  feedstockStorageLocationName: string | null;
  // M:M feedstocks
  feedstocks: ProductionRunFeedstockWithDetails[];
  // Canonical explicit source-bin withdrawals
  feedstockDraws: ProductionRunFeedstockDrawWithDetails[];
  // Computed fields
  totalFeedstockWetMassKg: number;
}

export interface PaginatedProductionRuns {
  items: ProductionRunWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ProductionRunStats {
  totalRuns: number;
  totalBiocharKg: number | null;
  totalBiocharDryKg: number | null;
  totalFeedstockWetKg: number;
  runningCount: number;
  completedCount: number;
  draftCount: number;
}

export interface FacilityEnergyTotals {
  runCount: number;
  electricityKwh: number | null;
  gensetLitres: number | null;
  startupLitres: number | null;
}

export interface ProductionRunReadingRecord {
  id: string;
  productionRunId: string;
  timestamp: Date;
  temperatureC: number | null;
  pressureBar: number | null;
  gasFlowRate: number | null;
  createdAt: Date;
}

export type ProductionRunWithSamples = ProductionRun & {
  hasReadingsFile: boolean;
  samples: Sample[];
};
