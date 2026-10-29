import { describe, expect, it } from "vitest";
import { recordHref } from "@/lib/record-links";
import {
  BATCH_EDGES,
  BATCH_NODES,
  FACILITY,
  FACILITY_ID,
  FIELD_ONE,
  SUPPLIER_ONE,
  batchGeo,
  batchModel,
} from "./trace-fixtures";
import {
  buildTraceModel,
  groupDrawnLegs,
  recordLegs,
  restingLighting,
  splitWetDry,
  stageLighting,
  uniqueLegKm,
} from "./trace-model";

describe("buildTraceModel", () => {
  it("groups records into stages in chain order, by code within a stage", () => {
    const model = batchModel();
    expect(model.stages.map((stage) => stage.kind)).toEqual([
      "feedstock",
      "productionRun",
      "biocharProduct",
      "delivery",
      "application",
    ]);
    expect(model.stages[0]!.title).toBe("Feedstock intake");
    expect(model.stages[0]!.records.map((record) => record.shortCode)).toEqual(["FS-26-001", "FS-26-002"]);
  });

  it("leaves out kinds with no stage (the reactor) and empty stages", () => {
    const model = buildTraceModel(BATCH_NODES.slice(0, 3), BATCH_EDGES, batchGeo());
    expect(model.stages.map((stage) => stage.kind)).toEqual(["feedstock", "productionRun"]);
  });

  it("builds every record link with recordHref on the batch's facility", () => {
    const model = batchModel();
    expect(model.records.get("application:ap1")!.href).toBe(
      recordHref("application", "ap1", { facilityId: FACILITY_ID }),
    );
    expect(model.records.get("production-run:pr1")!.href).toBe(
      recordHref("productionRun", "pr1", { facilityId: FACILITY_ID }),
    );
  });

  it("places a record only where it has its own position", () => {
    const model = batchModel();
    expect(model.records.get("feedstock:fs1")!.position).toEqual(SUPPLIER_ONE);
    expect(model.records.get("application:ap1")!.position).toEqual(FIELD_ONE);
    expect(model.records.get("production-run:pr1")!.position).toBeNull();
  });

  it("has no facility point when the facility is not geolocated", () => {
    const model = batchModel({ facility: { id: FACILITY_ID, code: "FAC-1", name: "Mafinga", lat: null, lng: null } });
    expect(model.facility).toBeNull();
  });
});

describe("groupDrawnLegs", () => {
  it("draws one road once when several legs share it", () => {
    const model = batchModel();
    expect(model.plottable.size).toBe(5);
    const drawn = groupDrawnLegs(model.plottable.values());
    expect(drawn).toHaveLength(4);
    const shared = drawn.find((leg) => leg.legIds.includes("out-1"));
    expect(shared!.legIds).toEqual(["out-1", "out-1-layer-2"]);
  });

  it("keeps an inbound and an outbound leg on the same two places apart", () => {
    const model = batchModel({
      legs: batchGeo().legs.slice(0, 1).concat([
        { ...batchGeo().legs[2]!, id: "back", originLat: SUPPLIER_ONE.lat, originLng: SUPPLIER_ONE.lng, destinationLat: FACILITY.lat, destinationLng: FACILITY.lng },
      ]),
    });
    expect(groupDrawnLegs(model.plottable.values())).toHaveLength(2);
  });
});

describe("legs and km", () => {
  it("counts a road with the same stored km once", () => {
    const model = batchModel();
    expect(uniqueLegKm(model, model.geo.legs.filter((leg) => leg.kind === "outbound" && leg.entityId === "ap1"))).toBe(420);
  });

  it("lists a record's own legs once per road", () => {
    const model = batchModel();
    expect(recordLegs(model, "application:ap1").map((leg) => leg.id)).toEqual(["out-1"]);
    expect(recordLegs(model, "feedstock:fs2").map((leg) => leg.id)).toEqual(["in-2"]);
  });

  it("gives a delivery the outbound legs of the fields it supplied", () => {
    const model = batchModel();
    expect(recordLegs(model, "delivery:dl1").map((leg) => leg.id)).toEqual(["out-1", "out-2"]);
  });
});

describe("lighting", () => {
  it("rests with nothing lit and the whole batch framed", () => {
    const model = batchModel();
    const lighting = restingLighting(model);
    expect(lighting.nodeIds).toBeNull();
    expect(lighting.legIds.size).toBe(0);
    expect(lighting.points).toContainEqual(FACILITY);
    expect(lighting.points).toContainEqual(FIELD_ONE);
  });

  it("lights a stage's own records and legs", () => {
    const model = batchModel();
    const applications = model.stages.find((stage) => stage.kind === "application")!;
    const lighting = stageLighting(model, applications);
    expect([...lighting.nodeIds!].sort()).toEqual(["application:ap1", "application:ap2"]);
    expect([...lighting.legIds].sort()).toEqual(["out-1", "out-1-layer-2", "out-2"]);
  });

  it("frames a stage at the facility on the facility alone", () => {
    const model = batchModel();
    const runs = model.stages.find((stage) => stage.kind === "productionRun")!;
    const lighting = stageLighting(model, runs);
    expect(lighting.points).toEqual([FACILITY]);
    expect(lighting.facilityLit).toBe(true);
  });
});

describe("splitWetDry", () => {
  it("reads a wet and dry pair, wet first", () => {
    expect(splitWetDry("Wet: 350 kg · Dry: 315 kg")).toEqual({ wet: "350 kg", dry: "315 kg" });
    expect(splitWetDry("350 kg")).toBeNull();
  });
});
