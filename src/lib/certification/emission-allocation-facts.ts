import type { FeedstockDeliveryUsage } from "@/types/feedstock-delivery-usage";
import type { EmissionAllocation, Quantity } from "@/types/emission-allocation";

export interface AllocationFeedstockFact {
  id: string;
  code: string;
  date: string;
  binId: string;
  binName: string;
  usage: FeedstockDeliveryUsage;
  legs: { id: string; oneWayKm: number; loadKg: number | null }[];
  /** Resolved by the existing ownership seam, not inferred from physical losses. */
  firstRun?: { id: string; code: string; date: string; creditBatchId: string };
  runsByBatch: Record<string, string[]>;
}

export interface AllocationRunFact {
  id: string;
  code: string;
  date: string;
  creditBatchId: string | null;
  reactorId: string | null;
  reactorCode: string | null;
  dieselOperationLiters: number | null;
  dieselGensetLiters: number | null;
  preprocessingFuelLiters: number | null;
  electricityKwh: number | null;
}

export interface AllocationDeliveryFact {
  id: string;
  code: string;
  date: string;
  /** Whole physical load, including any unbatched biochar. */
  wetKg: number | null;
  oneWayKm: number | null;
  /** Existing emissionDeliveryShares, grouped once per batch and delivery. */
  loads: { creditBatchId: string; code: string; kg: number | null }[];
  /** Each Removal's applied wet load on this delivery, from its frozen application slices. */
  removalLoads?: { removalId: string; code: string; kg: number }[];
}

export interface AllocationManualFact {
  id: string;
  componentId: string;
  componentName: string;
  date: string;
  creditBatchId: string;
  kind: "value" | "zero";
  quantities: Quantity[];
  omittedInputKeys: string[];
  removalId?: string | null;
}

export interface EmissionAllocationFacts extends Omit<EmissionAllocation, "records"> {
  /** Persisted production claim, independent of slice membership. */
  productionClaims?: Record<string, string | null>;
  feedstocks: AllocationFeedstockFact[];
  runs: AllocationRunFact[];
  deliveries: AllocationDeliveryFact[];
  manual: AllocationManualFact[];
}
