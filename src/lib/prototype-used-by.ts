/**
 * PROTOTYPE ONLY (Used by section round). Shared shapes for the prototype
 * read in `src/data-access/prototype-used-by.ts` and the variants next to
 * `src/components/record-locks/record-used-by.tsx`. Delete with the prototype.
 */

export const PROTOTYPE_USED_BY_KINDS = [
  "feedstock", "productionRun", "biocharProduct", "order", "delivery", "application", "sample", "creditBatch", "removal",
] as const;
export type PrototypeUsedByKind = (typeof PROTOTYPE_USED_BY_KINDS)[number];

/** Mass that moved along a link: wet as weighed, or the run's dry biochar. */
export interface PrototypeUsedByMass {
  kg: number;
  basis: "wet" | "dryBiochar";
}

export interface PrototypeUsedByNode {
  kind: PrototypeUsedByKind;
  id: string;
  code: string;
  /** Credit batches only: the optional name that replaces the code. */
  name: string | null;
  facilityId: string | null;
  /** ISO instant or `YYYY-MM-DD`; null when the record has no date. */
  at: string | null;
  /** A business date stored as UTC midnight: reads without the facility clock. */
  calendarDay: boolean;
  /** Fixture records link nowhere. */
  fixture?: boolean;
}

export interface PrototypeUsedByEdge {
  from: string;
  to: string;
  mass: PrototypeUsedByMass | null;
}

export interface PrototypeUsedByBatch {
  id: string;
  code: string;
  name: string | null;
  facilityId: string;
  startDate: string;
  endDate: string;
}

export interface PrototypeUsedByGraph {
  self: PrototypeUsedByNode;
  /** What the record came from, one step back. */
  upstream: PrototypeUsedByNode[];
  /** Every record its material or numbers reached, in custody order. */
  downstream: PrototypeUsedByNode[];
  edges: PrototypeUsedByEdge[];
  creditBatches: PrototypeUsedByBatch[];
  /** Keyed by node key: what this record gave each record that uses it directly. */
  took: Record<string, PrototypeUsedByMass>;
}

export function prototypeNodeKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}
