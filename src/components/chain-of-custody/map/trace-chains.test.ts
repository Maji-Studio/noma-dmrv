import { describe, expect, it } from "vitest";
import { buildChains, chainFor, chainStepLighting, chainTo } from "./trace-chains";
import { BATCH_EDGES, BATCH_NODES, FACILITY, FIELD_ONE, SUPPLIER_ONE, batchGeo, batchModel } from "./trace-fixtures";
import { buildTraceModel } from "./trace-model";

describe("buildChains", () => {
  it("makes one chain per field, fields in code order", () => {
    const chains = buildChains(batchModel());
    expect(chains.map((chain) => chain.end.id)).toEqual(["application:ap1", "application:ap2"]);
  });

  it("lists every record upstream of the end in chain order", () => {
    const chain = chainTo(batchModel(), "application:ap1")!;
    expect(chain.steps.map((step) => step.shortCode)).toEqual([
      "FS-26-001",
      "FS-26-002",
      "PR-26-001",
      "BP-26-001",
      "DL-26-001",
      "Field A",
    ]);
  });

  it("counts a chain's one-way km with each road once", () => {
    const chain = chainTo(batchModel(), "application:ap1")!;
    // 30 + 60 inbound, 420 outbound once although two product layers carry it.
    expect(chain.distanceKm).toBe(510);
    expect([...chain.legIds].sort()).toEqual(["in-1", "in-2", "out-1", "out-1-layer-2"]);
  });

  it("ends a chain at the delivery when nothing is applied yet", () => {
    const model = buildTraceModel(BATCH_NODES.slice(0, 5), BATCH_EDGES.slice(0, 4), batchGeo({ legs: batchGeo().legs.slice(0, 2) }));
    const chains = buildChains(model);
    expect(chains.map((chain) => chain.end.id)).toEqual(["delivery:dl1"]);
    expect(chains[0]!.steps).toHaveLength(5);
  });

  it("ends a chain at the bin's product when it has no delivery either", () => {
    const model = buildTraceModel(BATCH_NODES.slice(0, 4), BATCH_EDGES.slice(0, 3), batchGeo({ legs: batchGeo().legs.slice(0, 2) }));
    expect(buildChains(model).map((chain) => chain.end.id)).toEqual(["biochar-product:bp1"]);
  });

  it("never makes a chain of a lone feedstock", () => {
    const model = buildTraceModel(BATCH_NODES.slice(0, 1), [], batchGeo());
    expect(buildChains(model)).toEqual([]);
  });
});

describe("chainFor", () => {
  it("picks the first chain through a record, fields first", () => {
    const model = batchModel();
    const chain = chainFor(model, buildChains(model), "production-run:pr1")!;
    expect(chain.end.id).toBe("application:ap1");
  });

  it("falls back to a chain that ends at the record", () => {
    const model = batchModel();
    expect(chainFor(model, [], "delivery:dl1")!.end.id).toBe("delivery:dl1");
    expect(chainFor(model, [], "missing:x")).toBeNull();
  });
});

describe("chainStepLighting", () => {
  it("keeps the whole chain lit and frames the current step", () => {
    const model = batchModel();
    const chain = chainTo(model, "application:ap1")!;
    const supplier = chainStepLighting(model, chain, chain.steps[0]!);
    expect(supplier.nodeIds!.has("application:ap1")).toBe(true);
    expect(supplier.nodeIds!.has("application:ap2")).toBe(false);
    expect(supplier.legIds).toEqual(chain.legIds);
    expect(supplier.currentNodeId).toBe("feedstock:fs1");
    expect(supplier.points).toContainEqual(SUPPLIER_ONE);
  });

  it("frames a step at the facility on the facility", () => {
    const model = batchModel();
    const chain = chainTo(model, "application:ap1")!;
    const run = chain.steps.find((step) => step.kind === "productionRun")!;
    expect(chainStepLighting(model, chain, run).points).toEqual([FACILITY]);
  });

  it("frames a delivery on the roads it supplied", () => {
    const model = batchModel();
    const chain = chainTo(model, "application:ap1")!;
    const delivery = chain.steps.find((step) => step.kind === "delivery")!;
    const points = chainStepLighting(model, chain, delivery).points;
    expect(points).toContainEqual(FACILITY);
    expect(points).toContainEqual(FIELD_ONE);
  });

  it("frames a chain with no geolocated records on the facility", () => {
    const model = buildTraceModel(BATCH_NODES, BATCH_EDGES, batchGeo({ nodes: [], legs: [] }));
    const chain = chainTo(model, "application:ap1")!;
    expect(chain.distanceKm).toBe(0);
    expect(chainStepLighting(model, chain, chain.steps[0]!).points).toEqual([FACILITY]);
  });
});
