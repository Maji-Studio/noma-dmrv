import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { buildChains, chainTo } from "./trace-chains";
import { BATCH_EDGES, BATCH_NODES, batchGeo, edge, recordNode } from "./trace-fixtures";
import { lineageIdsByApplication, lineageRecordIds } from "./trace-lineage";
import { buildTraceModel } from "./trace-model";

/** One delivery carrying two products; each field was allocated only one of them. */
function lineage(applicationId: string, productId: string, runId: string, feedstockId: string): ChainOfCustodyData {
  const source = { productionRun: { id: runId }, reactor: null, feedstocks: [{ id: feedstockId }], allocatedWetMassKg: null, allocatedDryMassKg: null };
  return {
    application: { id: applicationId },
    delivery: { id: "dl1" },
    order: { id: "or1" },
    biocharProduct: null,
    productionRun: null,
    reactor: null,
    feedstocks: [],
    products: [{ product: { id: productId }, sources: [source], allocatedWetMassKg: 100, allocatedDryMassKg: 90 }],
  } as unknown as ChainOfCustodyData;
}

const LINEAGES = [lineage("ap1", "bp1", "pr1", "fs1"), lineage("ap2", "bp2", "pr2", "fs2")];

function twoProductModel() {
  const nodes = [
    recordNode("feedstock", "feedstock:fs1", "FS-1"),
    recordNode("feedstock", "feedstock:fs2", "FS-2"),
    recordNode("productionRun", "production-run:pr1", "PR-1"),
    recordNode("productionRun", "production-run:pr2", "PR-2"),
    recordNode("biocharProduct", "biochar-product:bp1", "BP-1"),
    recordNode("biocharProduct", "biochar-product:bp2", "BP-2"),
    recordNode("order", "order:or1", "OR-1"),
    recordNode("delivery", "delivery:dl1", "DL-1"),
    recordNode("application", "application:ap1", "Field A"),
    recordNode("application", "application:ap2", "Field B"),
  ];
  const edges = [
    edge("feedstock:fs1", "production-run:pr1"),
    edge("feedstock:fs2", "production-run:pr2"),
    edge("production-run:pr1", "biochar-product:bp1"),
    edge("production-run:pr2", "biochar-product:bp2"),
    edge("biochar-product:bp1", "order:or1"),
    edge("biochar-product:bp2", "order:or1"),
    edge("order:or1", "delivery:dl1"),
    edge("delivery:dl1", "application:ap1"),
    edge("delivery:dl1", "application:ap2"),
  ];
  const base = batchGeo();
  return buildTraceModel(nodes, edges, batchGeo({ legs: base.legs.filter((leg) => leg.id !== "out-1-layer-2") }), lineageIdsByApplication(LINEAGES));
}

describe("lineageRecordIds", () => {
  it("lists the application, delivery, order, its product, run and intakes in graph node ids", () => {
    expect([...lineageRecordIds(LINEAGES[0]!)].sort()).toEqual([
      "application:ap1",
      "biochar-product:bp1",
      "delivery:dl1",
      "feedstock:fs1",
      "order:or1",
      "production-run:pr1",
    ]);
  });

  it("reads a single-product lineage from its biochar product and sources", () => {
    const single = {
      ...LINEAGES[0]!,
      products: undefined,
      biocharProduct: { id: "bp9" },
      sources: [{ productionRun: { id: "pr9" }, reactor: null, feedstocks: [{ id: "fs9" }], allocatedWetMassKg: null, allocatedDryMassKg: null }],
    } as unknown as ChainOfCustodyData;
    const ids = lineageRecordIds(single);
    expect(ids.has("biochar-product:bp9") && ids.has("production-run:pr9") && ids.has("feedstock:fs9")).toBe(true);
  });
});

describe("a chain is only what its application was supplied from", () => {
  it("holds only the allocated product, its run, intakes and legs", () => {
    const model = twoProductModel();
    const first = chainTo(model, "application:ap1")!;
    expect(first.steps.map((step) => step.id)).toEqual([
      "feedstock:fs1",
      "production-run:pr1",
      "biochar-product:bp1",
      "order:or1",
      "delivery:dl1",
      "application:ap1",
    ]);
    expect([...first.legIds].sort()).toEqual(["in-1", "out-1"]);
    const second = chainTo(model, "application:ap2")!;
    expect(second.steps.map((step) => step.id)).toEqual([
      "feedstock:fs2",
      "production-run:pr2",
      "biochar-product:bp2",
      "order:or1",
      "delivery:dl1",
      "application:ap2",
    ]);
    expect([...second.legIds].sort()).toEqual(["in-2", "out-2"]);
  });

  it("keeps the ancestor walk for an end with nothing applied", () => {
    const model = buildTraceModel(BATCH_NODES.slice(0, 5), BATCH_EDGES.slice(0, 4), batchGeo(), lineageIdsByApplication(LINEAGES));
    const chains = buildChains(model);
    expect(chains.map((chain) => chain.end.id)).toEqual(["delivery:dl1"]);
    expect(chains[0]!.steps).toHaveLength(5);
  });
});

describe("lineageIdsByApplication", () => {
  it("unions the product slices of one application", () => {
    const ids = lineageIdsByApplication([lineage("ap1", "bp1", "pr1", "fs1"), lineage("ap1", "bp2", "pr2", "fs2")]).get("application:ap1");
    expect(ids).toEqual(
      new Set(["application:ap1", "delivery:dl1", "order:or1", "biochar-product:bp1", "biochar-product:bp2", "production-run:pr1", "production-run:pr2", "feedstock:fs1", "feedstock:fs2"]),
    );
  });
});
