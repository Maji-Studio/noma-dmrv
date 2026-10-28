/**
 * The figures a registered Production Batch differs on, saved on the drift
 * sync event as raw values. Display code formats them at render time.
 */
export type DriftDifference =
  | { field: "facility" | "kind"; isometric: string; noma: string }
  | { field: "feedstockTypes"; isometric: string[]; noma: string[] }
  | { field: "dryMass"; isometric: { magnitude: number; unit: string }; noma: { magnitude: number; unit: string } }
  | { field: "windowStart" | "windowEnd"; isometric: string; noma: string };

export interface DriftDetails {
  creditBatchId: string;
  creditBatchCode: string;
  differences: DriftDifference[];
  /** Another Removal also uses this credit batch, so deleting this one does not fix it. */
  shared: boolean;
  /** That other Removal, when it can be named. */
  sharedWith: { id: string; code: string } | null;
}

/** Reads the details back from a drift event's response payload. Null for events saved before they existed. */
export function readDriftDetails(responsePayload: unknown): DriftDetails | null {
  if (!responsePayload || typeof responsePayload !== "object") return null;
  const drift = (responsePayload as { drift?: unknown }).drift;
  if (!drift || typeof drift !== "object") return null;
  const value = drift as Partial<DriftDetails>;
  if (typeof value.creditBatchId !== "string" || typeof value.creditBatchCode !== "string" || !Array.isArray(value.differences)) {
    return null;
  }
  return {
    creditBatchId: value.creditBatchId,
    creditBatchCode: value.creditBatchCode,
    differences: value.differences,
    shared: value.shared === true,
    sharedWith: value.sharedWith ?? null,
  };
}
