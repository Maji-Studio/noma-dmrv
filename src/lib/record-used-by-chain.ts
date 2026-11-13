export const RECORD_USED_BY_KINDS = [
  "feedstock", "productionRun", "biocharProduct", "order", "delivery", "application", "removal", "sample", "creditBatch",
] as const;
export type RecordUsedByKind = (typeof RECORD_USED_BY_KINDS)[number];

/** Mass that moved along a link: wet as weighed, or the run's dry biochar. */
export interface RecordUsedByMass {
  kg: number;
  basis: "wet" | "dryBiochar";
}

export interface RecordUsedByNode {
  kind: RecordUsedByKind;
  id: string;
  code: string;
  /** Credit batches only: the optional name that replaces the code. */
  name: string | null;
  facilityId: string | null;
  /** ISO instant or `YYYY-MM-DD`; null when the record has no date. */
  at: string | null;
  /** A calendar date string or UTC midnight: reads without the facility clock. */
  calendarDay: boolean;
}

export interface RecordUsedByEdge {
  from: string;
  to: string;
  mass: RecordUsedByMass | null;
}

export interface RecordUsedByBatch {
  id: string;
  code: string;
  name: string | null;
  facilityId: string;
  startDate: string;
  endDate: string;
}

export interface RecordUsedByChain {
  self: RecordUsedByNode;
  /** What the record came from, one step back. */
  upstream: RecordUsedByNode[];
  /** Every record its material or numbers reached, in custody order. */
  downstream: RecordUsedByNode[];
  edges: RecordUsedByEdge[];
  creditBatches: RecordUsedByBatch[];
}

export function usedByNodeKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}
