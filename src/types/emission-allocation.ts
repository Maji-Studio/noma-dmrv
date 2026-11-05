/** Batch IDs are UUIDs; this sentinel cannot collide with a stored ID. */
export const NOT_YET = "notYet" as const;
export type PartKey = string | typeof NOT_YET;
export type Unit = "t·km" | "L" | "kWh";
export type GroupKey = "feedstockTransport" | "production" | "deliveryTransport" | "manual";
export type EmissionAllocationInput = { creditBatchId: string } | { removalId: string };

export interface Quantity {
  /** Missing readings stay unknown, never zero. */
  value: number | null;
  unit: Unit;
  label: string;
}

/** wouldClaim marks a pending production claim, entry send, or frozen delivery slice. */
export interface PartBasis {
  kind: "firstRun" | "run" | "load" | "recordedOnBatch" | "notYet" | "claim" | "slice" | "wouldClaim";
  /** Stored code or input label, without a prebuilt explanatory sentence. */
  label: string;
  kg: number | null;
  recordId?: string;
}

export interface Part {
  /** creditBatchId or removalId (for removalParts), or NOT_YET. */
  key: PartKey;
  fraction: number;
  basis: PartBasis[];
}

export interface BatchUse {
  creditBatchId: string;
  code: string;
  kg: number;
  /** Stored run codes. */
  runs: string[];
}

export interface MassOut {
  kind: "lost" | "failedRun";
  /** Null when only the usage loader's aggregate is available. */
  date: string | null;
  kg: number;
}

export interface FeedstockUse {
  bin: string;
  binId: string;
  wetKg: number;
  /** Whole delivery leg(s), including the empty return journey. */
  tonneKm: number | null;
  used: BatchUse[];
  out: MassOut[];
  lostKg: number;
  stillKg: number;
  /** Other physical uses are explicit; none of them owns transport. */
  ingredientKg: number;
  countKg: number;
  unbatchedRunKg: number;
  firstRun?: { id: string; code: string; date: string; creditBatchId: string };
  /** creditBatchId of the earliest eligible completed, batched run. */
  owner: string | null;
  reason: "firstRun" | "notYet";
}

export type AllocationDetail =
  | { kind: "feedstockTransport"; binId: string; binName: string; wetKg: number; legs: { id: string; oneWayKm: number; loadKg: number | null }[] }
  | { kind: "production"; reactorId: string | null; reactorCode: string | null }
  | { kind: "deliveryTransport"; wetKg: number | null; oneWayKm: number | null }
  | { kind: "manual"; creditBatchId: string; componentId: string; componentName: string; kindOfEntry: "value" | "zero"; omittedInputKeys: string[] };

export interface AllocationRecord {
  id: string;
  /** Manual entries have no generated code; their component ID identifies the line. */
  code: string;
  group: GroupKey;
  /** ISO calendar day; run days use the facility clock. */
  date: string;
  detail: AllocationDetail;
  quantities: Quantity[];
  /** Ordered parts sum to exactly one. Zero-share touching batches remain visible. */
  parts: Part[];
  /** Explicit submission ownership; ordered fractions sum to exactly one. */
  removalParts: Part[];
  basisWord: string;
  feedstock?: FeedstockUse;
}

export interface EmissionAllocation {
  facilityId: string;
  batches: { id: string; code: string; startDate: string; endDate: string }[];
  /** Membership for captions only; never use it to derive a Removal share. */
  removals: {
    id: string; code: string; status: string; creditBatchIds: string[];
    /** Unsent and still submittable: no attempt yet, a draft, or a rejection with no registry ID (retryable). */
    canSendProduction?: boolean;
  }[];
  records: AllocationRecord[];
}
