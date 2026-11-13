import { describe, expect, it } from "vitest";
import { usedByNodeKey, type RecordUsedByNode } from "./record-used-by-chain";
import { normalizeUsedByEdges, orderUsedByNodes, usedByEdge, usedByMass } from "./record-used-by-chain-graph";

function node(kind: RecordUsedByNode["kind"], id: string, at: string | null = null, code = id): RecordUsedByNode {
  return { kind, id, code, at, name: null, facilityId: null, calendarDay: true };
}

describe("Used by graph", () => {
  it("orders custody before verification, then date, code and id, regardless of discovery order", () => {
    const nodes = [node("creditBatch", "batch"), node("sample", "sample"), node("removal", "removal"),
      node("delivery", "unknown"), node("order", "order"), node("application", "application"),
      node("biocharProduct", "product"), node("productionRun", "run"), node("feedstock", "feedstock"),
      node("delivery", "b", "2026-06-15", "D-1"), node("delivery", "a", "2026-06-15T00:00:00.000Z", "D-1"),
      node("delivery", "c", "2026-06-15", "D-2"), node("delivery", "earliest", "2026-06-14")];
    expect(orderUsedByNodes([...nodes, nodes[0]]).map(item => item.id)).toEqual([
      "feedstock", "run", "product", "order", "earliest", "a", "b", "c", "unknown", "application", "removal", "sample", "batch",
    ]);
    expect(orderUsedByNodes([...nodes].reverse())).toEqual(orderUsedByNodes(nodes));
  });

  it("deduplicates repeated paths without adding their mass and removes dangling and self edges", () => {
    const nodes = [node("productionRun", "run"), node("biocharProduct", "product"), node("delivery", "delivery")];
    const product = usedByEdge("productionRun", "run", "biocharProduct", "product", usedByMass(285, "dryBiochar"));
    const delivery = usedByEdge("biocharProduct", "product", "delivery", "delivery", usedByMass(300, "wet"));
    const edges = [delivery, product, { ...product, mass: null }, product,
      usedByEdge("productionRun", "run", "productionRun", "run"), usedByEdge("delivery", "delivery", "application", "missing")];
    expect(normalizeUsedByEdges(edges, nodes)).toEqual([product, delivery]);
    expect(normalizeUsedByEdges([...edges].reverse(), nodes)).toEqual([product, delivery]);
    expect(usedByNodeKey("delivery", "delivery")).toBe("delivery:delivery");
  });

  it.each([null, 0, -1, NaN, Infinity, -Infinity])("omits unusable mass %s", kg => {
    expect(usedByMass(kg, "wet")).toBeNull();
  });

  it("keeps positive measured mass, including fractions, without estimating unknown links", () => {
    expect(usedByMass(0.001, "wet")).toEqual({ kg: 0.001, basis: "wet" });
    const nodes = [node("productionRun", "run"), node("creditBatch", "batch")];
    expect(normalizeUsedByEdges([usedByEdge("productionRun", "run", "creditBatch", "batch")], nodes)[0].mass).toBeNull();
    expect(normalizeUsedByEdges([usedByEdge("productionRun", "run", "creditBatch", "batch", { kg: -1, basis: "wet" })], nodes)[0].mass).toBeNull();
  });
});
