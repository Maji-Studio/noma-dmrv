/**
 * Shared types for the production-runs data-access layer.
 */

import type { ProductionRun, Sample } from "@/db/schema";
import type { ProductionRunStatus } from "@/lib/production-runs/lifecycle";

export interface ProductionRunFeedstockWithDetails {
  id: string;
  feedstockId: string;
  massUsedKg: number;
  feedstockCode: string | null;
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
  // Computed fields
  totalFeedstockMassKg: number;
  readingsCount: number;
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
  totalBiocharKg: number;
  totalBiocharDryKg: number | null;
  totalFeedstockKg: number;
  runningCount: number;
  completedCount: number;
  draftCount: number;
}

export interface FacilityEnergyTotals {
  runCount: number;
  electricityKwh: number;
  gensetLitres: number;
  startupLitres: number;
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
  samples: Sample[];
  readingsCount: number;
};
