/**
 * PROTOTYPE ONLY (Used by section round). `?scenario=many` swaps the real
 * read for this made-up chain: 9 production runs, 14 biochar products, 31
 * deliveries, 6 applications, 2 Removals, 2 Samples and 2 credit batches,
 * starting after the open record's own kind. Every figure here is invented.
 */
import type { RecordLockLink } from "@/lib/record-lock-view";
import {
  prototypeNodeKey, type PrototypeUsedByEdge, type PrototypeUsedByGraph, type PrototypeUsedByKind, type PrototypeUsedByMass, type PrototypeUsedByNode,
} from "@/lib/prototype-used-by";

export const SCENARIOS = ["real", "many", "none"] as const;
export type Scenario = (typeof SCENARIOS)[number];

const CHAIN: PrototypeUsedByKind[] = ["feedstock", "productionRun", "biocharProduct", "delivery", "application", "removal"];
const COUNTS: Partial<Record<PrototypeUsedByKind, number>> = { productionRun: 9, biocharProduct: 14, delivery: 31, application: 6, removal: 2, sample: 2 };
const PREFIX: Partial<Record<PrototypeUsedByKind, string>> = { productionRun: "PR", biocharProduct: "BP", delivery: "DL", application: "AP", removal: "RM", sample: "LS" };
const FIRST_NUMBER = 101;
const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 4, 2);
/** Made-up masses per link kind, kg. */
const MASS_BASE: Partial<Record<PrototypeUsedByKind, PrototypeUsedByMass>> = {
  productionRun: { kg: 2400, basis: "wet" },
  biocharProduct: { kg: 860, basis: "dryBiochar" },
  delivery: { kg: 3150, basis: "wet" },
  application: { kg: 7400, basis: "wet" },
  removal: { kg: 5200, basis: "dryBiochar" },
};
const MASS_STEP_KG = 37;

function stagesAfter(kind: PrototypeUsedByKind): PrototypeUsedByKind[] {
  if (kind === "order") return ["delivery", "application", "removal"];
  if (kind === "sample") return ["removal"];
  if (kind === "creditBatch") return ["removal"];
  const index = CHAIN.indexOf(kind);
  return index < 0 ? [] : CHAIN.slice(index + 1);
}

function fixtureNode(kind: PrototypeUsedByKind, index: number, facilityId: string | null): PrototypeUsedByNode {
  const day = new Date(START + (index * 2 + CHAIN.indexOf(kind) * 9) * DAY_MS).toISOString();
  return {
    kind, id: `fx-${kind}-${index}`, code: `${PREFIX[kind] ?? "XX"}-26-${FIRST_NUMBER + index}`, name: null, facilityId,
    at: kind === "removal" ? day.slice(0, 10) : day, calendarDay: kind === "application" || kind === "removal", fixture: true,
  };
}

export function prototypeFixture(self: PrototypeUsedByNode): { usedBy: RecordLockLink[]; graph: PrototypeUsedByGraph } {
  const facilityId = self.facilityId;
  const selfKey = prototypeNodeKey(self.kind, self.id);
  const downstream: PrototypeUsedByNode[] = [];
  const edges: PrototypeUsedByEdge[] = [];
  let parents = [selfKey];
  for (const kind of stagesAfter(self.kind)) {
    const stage = Array.from({ length: COUNTS[kind] ?? 0 }, (_, index) => fixtureNode(kind, index, facilityId));
    stage.forEach((node, index) => {
      const base = MASS_BASE[kind];
      edges.push({ from: parents[index % parents.length], to: prototypeNodeKey(kind, node.id), mass: base ? { ...base, kg: base.kg + index * MASS_STEP_KG } : null });
    });
    downstream.push(...stage);
    parents = stage.map((node) => prototypeNodeKey(kind, node.id));
  }
  const samples = self.kind === "sample" ? [] : Array.from({ length: COUNTS.sample ?? 0 }, (_, index) => fixtureNode("sample", index, facilityId));
  for (const sample of samples) edges.push({ from: selfKey, to: prototypeNodeKey("sample", sample.id), mass: null });
  downstream.push(...samples);
  const creditBatches = self.kind === "creditBatch" ? [] : [
    { id: "fx-creditBatch-0", code: "CB-26-101", name: null, facilityId: facilityId ?? "", startDate: "2026-05-01", endDate: "2026-05-31" },
    { id: "fx-creditBatch-1", code: "CB-26-102", name: "June lot", facilityId: facilityId ?? "", startDate: "2026-06-01", endDate: "2026-06-30" },
  ];
  const took = Object.fromEntries(edges.filter((edge) => edge.from === selfKey && edge.mass).map((edge) => [edge.to, edge.mass!]));
  // The list stresses every group at once: everything but the Removals, plus the batches.
  const listed = downstream.filter((node) => node.kind !== "removal");
  const usedBy: RecordLockLink[] = [
    ...listed.map((node) => ({ kind: node.kind, id: node.id, label: node.code, facilityId })),
    ...creditBatches.map((batch) => ({ kind: "creditBatch", id: batch.id, label: batch.code, facilityId })),
  ];
  // Records further down show the mass that reached them.
  for (const node of listed) {
    const key = prototypeNodeKey(node.kind, node.id);
    const inbound = edges.find((edge) => edge.to === key && edge.mass);
    if (!took[key] && inbound?.mass) took[key] = inbound.mass;
  }
  return { usedBy, graph: { self, upstream: [], downstream, edges, creditBatches, took } };
}
