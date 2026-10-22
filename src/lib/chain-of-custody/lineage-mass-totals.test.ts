import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { ChainRunRollForward } from "@/data-access/chain-of-custody-roll-forward";
import { kgToTonnes, tonnesToKg } from "@/lib/calculations/unit-conversions";
import {
  buildRollbackMassTotals,
  buildRollForwardMassTotals,
  edgeMass,
  nodeMass,
  sourceAllocationMass,
  type LineageMass,
  type LineageMassTotals,
} from "./lineage-mass-totals";
import {
  RUN_ID,
  PRODUCT_ID,
  APPLICATION_ID,
  DELIVERY_ID,
  SOURCE_EDGE_ID,
  SHIPMENT_EDGE_ID,
  APPLICATION_EDGE_ID,
  massTotalsLineage as lineage,
} from "./lineage-mass-totals-test-fixtures";

const UNKNOWN = { wetKg: null, dryKg: null };

function edgeKilograms(totals: LineageMassTotals, id: string): LineageMass | undefined {
  const mass = totals.edges.get(id);
  return mass && { wetKg: mass.wetKg, dryKg: mass.dryKg };
}

function expectAllocatedTotals(
  lineages: ChainOfCustodyData[],
  expected: LineageMass,
  expectedSourceEdge: LineageMass = expected,
): void {
  const totals = buildRollbackMassTotals(lineages);
  expect(totals.nodes.get(RUN_ID)).toEqual(expected);
  expect(totals.nodes.get(PRODUCT_ID)).toEqual({ ...expected, sourceAllocation: expected });
  expect(totals.nodes.get(APPLICATION_ID)).toEqual(expected);
  expect(edgeKilograms(totals, SOURCE_EDGE_ID)).toEqual(expectedSourceEdge);
  for (const id of [SHIPMENT_EDGE_ID, APPLICATION_EDGE_ID]) {
    expect(edgeKilograms(totals, id), id).toEqual(expected);
  }
}

describe("buildRollbackMassTotals", () => {
  it("has no totals without lineages", () => {
    expect(buildRollbackMassTotals([])).toEqual({ nodes: new Map(), edges: new Map() });
  });

  it("returns wet/dry kg per run, product, application and flow edge", () => {
    expectAllocatedTotals([lineage()], { wetKg: 120, dryKg: 90 });
  });

  it("sums unequal applications on shared runs/products/shipments, retaining application edges", () => {
    const first = lineage(12, 9);
    const second = lineage(24, 18);
    second.application.id = "application-2";
    const totals = buildRollbackMassTotals([first, second]);

    expect(totals.nodes.get(RUN_ID)).toEqual({ wetKg: 36, dryKg: 27 });
    expect(totals.nodes.get(PRODUCT_ID)).toMatchObject({ wetKg: 36, dryKg: 27 });
    expect(edgeKilograms(totals, SOURCE_EDGE_ID)).toEqual(totals.nodes.get(RUN_ID));
    expect(edgeKilograms(totals, SHIPMENT_EDGE_ID)).toMatchObject({ wetKg: 36 });
    expect(edgeKilograms(totals, SHIPMENT_EDGE_ID)?.dryKg).toBe(tonnesToKg(0.009 + 0.018));
    expect(totals.nodes.get(APPLICATION_ID)).toMatchObject({ wetKg: 12 });
    expect(totals.nodes.get("application:application-2")).toMatchObject({ wetKg: 24 });
    expect(edgeKilograms(totals, APPLICATION_EDGE_ID)).toEqual(totals.nodes.get(APPLICATION_ID));
    expect(edgeKilograms(totals, `${DELIVERY_ID}->application:application-2`)).toEqual(totals.nodes.get("application:application-2"));
  });

  it.each([
    [null, null, UNKNOWN, { wetKg: 850, dryKg: 833 }],
    [120, null, { wetKg: 120, dryKg: null }, { wetKg: 120, dryKg: 833 }],
    [null, 90, { wetKg: null, dryKg: 90 }, { wetKg: 850, dryKg: 90 }],
    [0, null, { wetKg: 0, dryKg: null }, { wetKg: 0, dryKg: 833 }],
    [null, 0, { wetKg: null, dryKg: 0 }, { wetKg: 850, dryKg: 0 }],
    [0, 0, { wetKg: 0, dryKg: 0 }, { wetKg: 0, dryKg: 0 }],
  ] as const)("keeps wet=%s and dry=%s independent", (wet, dry, expected, expectedEdge) => {
    expectAllocatedTotals([lineage(wet, dry)], expected, expectedEdge);
  });

  it("uses reported values when other slices are unknown, independently per basis", () => {
    expectAllocatedTotals([lineage(null, 90), lineage(120, null), lineage(null, null)], {
      wetKg: 120, dryKg: 90,
    }, { wetKg: 120, dryKg: 90 });
  });

  it("retains a reported zero alongside unknown slices", () => {
    expectAllocatedTotals([lineage(null, null), lineage(0, 0)], { wetKg: 0, dryKg: 0 }, { wetKg: 0, dryKg: 0 });
  });

  it("treats undefined and non-finite values as unreported", () => {
    const missing = lineage(null, null);
    missing.application.biocharAppliedTons = undefined;
    expectAllocatedTotals([missing, lineage(NaN, Infinity)], UNKNOWN, { wetKg: 850, dryKg: 833 });
    expectAllocatedTotals([missing, lineage(NaN, Infinity), lineage(0, 0)], { wetKg: 0, dryKg: 0 }, { wetKg: 0, dryKg: 0 });
  });

  it("keeps applied product totals distinct from source allocations", () => {
    const data = lineage(850, 820);
    data.sources![0].allocatedDryMassKg = 833;
    const totals = buildRollbackMassTotals([data]);
    expect(totals.nodes.get(RUN_ID)).toEqual({ wetKg: 850, dryKg: 833 });
    expect(totals.nodes.get(PRODUCT_ID)).toEqual({
      wetKg: 850, dryKg: 820, sourceAllocation: { wetKg: 850, dryKg: 833 },
    });
    expect(edgeKilograms(totals, SOURCE_EDGE_ID)).toEqual({ wetKg: 850, dryKg: 833 });
    expect(edgeKilograms(totals, SHIPMENT_EDGE_ID)).toEqual({ wetKg: 850, dryKg: 820 });
  });

  it("sums commingled applied shares while retaining distinct run allocations", () => {
    const first = lineage(510, 499.8);
    const second = lineage(340, 320.2);
    second.sources![0].productionRun.id = "run-2";
    second.sources![0].allocatedDryMassKg = 333.2;
    const totals = buildRollbackMassTotals([first, second]);

    expect(totals.nodes.get(RUN_ID)).toEqual({ wetKg: 510, dryKg: 499.8 });
    expect(totals.nodes.get("production-run:run-2")).toEqual({ wetKg: 340, dryKg: 333.2 });
    expect(totals.nodes.get(PRODUCT_ID)).toEqual({
      wetKg: 850, dryKg: 820, sourceAllocation: { wetKg: 850, dryKg: 833 },
    });
    expect(totals.nodes.get(APPLICATION_ID)).toEqual({
      wetKg: tonnesToKg(0.51 + 0.34), dryKg: tonnesToKg(0.4998 + 0.3202),
    });
    expect(edgeKilograms(totals, SHIPMENT_EDGE_ID)).toEqual({ wetKg: 850, dryKg: tonnesToKg(0.4998 + 0.3202) });
    expect(edgeKilograms(totals, APPLICATION_EDGE_ID)).toEqual({ wetKg: 850, dryKg: tonnesToKg(0.4998 + 0.3202) });
  });

  it("adds different product branches sharing a run into one physical application", () => {
    const first = lineage(750, 450);
    const second = lineage(250, 125);
    second.biocharProduct!.id = "product-2";
    const totals = buildRollbackMassTotals([first, second]);
    expect(totals.nodes.get(RUN_ID)).toEqual({ wetKg: 1_000, dryKg: 575 });
    expect(totals.nodes.get(APPLICATION_ID)).toEqual({ wetKg: 1_000, dryKg: 575 });
    expect(totals.nodes.get(PRODUCT_ID)).toMatchObject({ wetKg: 750, dryKg: 450 });
    expect(totals.nodes.get("biochar-product:product-2")).toMatchObject({ wetKg: 250, dryKg: 125 });
    expect(edgeKilograms(totals, APPLICATION_EDGE_ID)).toEqual({ wetKg: 1_000, dryKg: 575 });
    expect(edgeKilograms(totals, SHIPMENT_EDGE_ID)).toEqual({ wetKg: 750, dryKg: 450 });
    expect(edgeKilograms(totals, `biochar-product:product-2->${DELIVERY_ID}`)).toEqual({ wetKg: 250, dryKg: 125 });
  });

  it("adds multiple sources once each without multiplying an application's share", () => {
    const data = lineage(850, 820);
    data.sources![0].allocatedWetMassKg = 510;
    data.sources![0].allocatedDryMassKg = 499.8;
    data.sources!.push({
      ...data.sources![0],
      productionRun: { ...data.productionRun!, id: "run-2" },
      allocatedWetMassKg: 340, allocatedDryMassKg: 333.2,
    });
    const totals = buildRollbackMassTotals([data]);
    expect(totals.nodes.get(PRODUCT_ID)).toEqual({
      wetKg: 850, dryKg: 820, sourceAllocation: { wetKg: 850, dryKg: 833 },
    });
    expect(edgeKilograms(totals, SHIPMENT_EDGE_ID)).toEqual({ wetKg: 850, dryKg: 820 });
  });

  it.each([undefined, []])("uses whole lot mass only on the legacy singular source edge (%s)", sources => {
    const data = lineage();
    data.sources = sources;
    const totals = buildRollbackMassTotals([data]);
    expect(totals.nodes.get(RUN_ID)).toEqual(UNKNOWN);
    expect(edgeKilograms(totals, SOURCE_EDGE_ID)).toEqual({ wetKg: 850, dryKg: 833 });
    expect(totals.nodes.get(PRODUCT_ID)).toEqual({ wetKg: 120, dryKg: 90, sourceAllocation: UNKNOWN });
  });

  it("keeps explicit missing node allocations unknown even when the edge falls back", () => {
    const totals = buildRollbackMassTotals([lineage(null, null)]);
    expect(edgeKilograms(totals, SOURCE_EDGE_ID)).toEqual({ wetKg: 850, dryKg: 833 });
    expect(totals.nodes.get(RUN_ID)).toEqual(UNKNOWN);
    expect(totals.nodes.get(PRODUCT_ID)?.sourceAllocation).toEqual(UNKNOWN);
  });

  it.each([
    [null, null, { wetKg: 850, dryKg: 833 }],
    [120, null, { wetKg: 120, dryKg: 833 }],
    [null, 90, { wetKg: 850, dryKg: 90 }],
    [0, null, { wetKg: 0, dryKg: 833 }],
    [null, 0, { wetKg: 850, dryKg: 0 }],
  ] as const)("falls back per basis only on the single-source edge (wet=%s, dry=%s)", (wet, dry, expected) => {
    const totals = buildRollbackMassTotals([lineage(wet, dry)]);
    expect(edgeKilograms(totals, SOURCE_EDGE_ID)).toEqual(expected);
    expect(totals.nodes.get(RUN_ID)).toEqual({ wetKg: wet, dryKg: dry });
    expect(totals.nodes.get(PRODUCT_ID)?.sourceAllocation).toEqual({ wetKg: wet, dryKg: dry });
  });

  it("keeps a null product mass unknown in the single-source fallback", () => {
    const data = lineage(null, null);
    data.biocharProduct!.massKg = null;
    const totals = buildRollbackMassTotals([data]);
    expect(edgeKilograms(totals, SOURCE_EDGE_ID)).toEqual(UNKNOWN);
    expect(totals.nodes.get(PRODUCT_ID)?.sourceAllocation).toEqual(UNKNOWN);
  });

  it("does not fall back for missing allocations on a multi-source lineage", () => {
    const data = lineage(null, null);
    data.sources!.push({
      ...data.sources![0],
      productionRun: { ...data.productionRun!, id: "run-2" },
      allocatedWetMassKg: 120,
    });
    const totals = buildRollbackMassTotals([data]);
    expect(edgeKilograms(totals, SOURCE_EDGE_ID)).toEqual(UNKNOWN);
    expect(edgeKilograms(totals, `production-run:run-2->${PRODUCT_ID}`)).toEqual({ wetKg: 120, dryKg: null });
    expect(totals.nodes.get(PRODUCT_ID)?.sourceAllocation).toEqual({ wetKg: 120, dryKg: null });
  });

  it("handles an incomplete chain without a product or source", () => {
    const data = lineage();
    data.sources = [];
    data.productionRun = null;
    data.biocharProduct = null;
    data.order = null;
    const totals = buildRollbackMassTotals([data]);
    expect(totals.nodes.has(RUN_ID)).toBe(false);
    expect(totals.nodes.has(PRODUCT_ID)).toBe(false);
    expect(totals.edges.size).toBe(1);
    expect(edgeKilograms(totals, APPLICATION_EDGE_ID)).toEqual({ wetKg: 120, dryKg: 90 });
  });

  it("uses the recorded legacy mass once for two unknown slices of one product", () => {
    expectAllocatedTotals([lineage(null, null), lineage(null, null)], UNKNOWN, { wetKg: 850, dryKg: 833 });
  });

  it("does not add the whole product mass to an edge that already has an allocated slice", () => {
    // The whole-product fallback applies only when no slice on the edge has an
    // allocation, so the product's mass is never double counted.
    const totals = buildRollbackMassTotals([lineage(100, 98), lineage(null, null)]);
    expect(edgeKilograms(totals, SOURCE_EDGE_ID)).toEqual({ wetKg: 100, dryKg: 98 });
  });

  it("returns unknown masses for missing node, allocation and edge entries", () => {
    const totals = buildRollbackMassTotals([]);
    expect(nodeMass(totals, RUN_ID)).toEqual(UNKNOWN);
    expect(sourceAllocationMass(totals, PRODUCT_ID)).toEqual(UNKNOWN);
    expect(edgeMass(totals, RUN_ID, PRODUCT_ID)).toEqual({ ...UNKNOWN, mass: null, unit: "kg" });
  });

  it("sums application tonnes before converting, retaining kg sums for product cards", () => {
    const slices = [lineage(100.002, 100.002), lineage(100.148, 100.148)];
    const totals = buildRollbackMassTotals(slices);
    const tonnesSumInKg = tonnesToKg(0.100002 + 0.100148);
    expect(totals.nodes.get(APPLICATION_ID)).toEqual({ wetKg: tonnesSumInKg, dryKg: tonnesSumInKg });
    expect(totals.nodes.get(PRODUCT_ID)).toMatchObject({ wetKg: 100.002 + 100.148, dryKg: 100.002 + 100.148 });
    expect(totals.edges.get(APPLICATION_EDGE_ID)).toEqual({
      wetKg: 100.002 + 100.148, dryKg: tonnesSumInKg, mass: 0.100002 + 0.100148, unit: "tDry",
    });
  });

  it.each([0.0288, 0.82])("retains the exact native dry-tonne edge mass %s", dryTonnes => {
    const data = lineage();
    data.application.biocharAppliedDryTons = dryTonnes;
    const totals = buildRollbackMassTotals([data]);
    for (const id of [SHIPMENT_EDGE_ID, APPLICATION_EDGE_ID]) {
      expect(totals.edges.get(id)?.mass).toBe(dryTonnes);
      expect(totals.edges.get(id)?.unit).toBe("tDry");
    }
  });

  it("is exactly order independent, including floating-point sums, and does not mutate lineages", () => {
    const lineages = [lineage(0.1, 0.3), lineage(0.2, null), lineage(0.3, 0.1), lineage(null, 0.2)];
    const original = structuredClone(lineages);
    const expected = buildRollbackMassTotals(lineages);
    for (const reordered of [
      [...lineages].reverse(),
      [lineages[2], lineages[0], lineages[3], lineages[1]],
      [lineages[1], lineages[3], lineages[2], lineages[0]],
    ]) {
      expect(buildRollbackMassTotals(reordered)).toEqual(expected);
    }
    expect(lineages).toEqual(original);
  });
});

describe("buildRollForwardMassTotals", () => {
  function forward(runId: string, wetKg: number | null, dryKg: number): ChainRunRollForward {
    const data = lineage();
    return {
      source: { ...data.sources![0], productionRun: { ...data.productionRun!, id: runId } },
      products: [{
        product: data.biocharProduct!, drawnWetMassKg: 600, drawnDryMassKg: 570,
        deliveries: [{ delivery: data.delivery, wetMassKg: wetKg, dryMassKg: dryKg }],
      }],
    };
  }

  it("sums draws in kg and per-run shipments in dry tonnes", () => {
    const totals = buildRollForwardMassTotals([forward("run-1", 320, 300), forward("run-2", 80, 80)]);
    expect(nodeMass(totals, PRODUCT_ID)).toEqual({ wetKg: 1_200, dryKg: 1_140 });
    expect(edgeMass(totals, PRODUCT_ID, DELIVERY_ID)).toEqual({
      wetKg: 400, dryKg: tonnesToKg(0.3 + 0.08), mass: 0.3 + 0.08, unit: "tDry",
    });
  });

  it("is exactly order independent for float-sensitive shares and the single-shipment kg override", () => {
    const shares = [0.1, 0.2, 0.3];
    const rollForwards = shares.map(share => {
      const data = forward("run-1", share, tonnesToKg(share));
      data.products[0].drawnWetMassKg = share;
      data.products[0].drawnDryMassKg = share;
      return data;
    });
    const singleDeliveryId = "delivery:delivery-single";
    const recordedDryKg = 63.7;
    const deliveries = rollForwards[0].products[0].deliveries;
    deliveries.push({
      delivery: { ...deliveries[0].delivery, id: "delivery-single" },
      wetMassKg: recordedDryKg,
      dryMassKg: recordedDryKg,
    });
    const original = structuredClone(rollForwards);
    const expected = buildRollForwardMassTotals(rollForwards);
    const shareSum = 0.1 + 0.2 + 0.3;
    expect(nodeMass(expected, PRODUCT_ID)).toEqual({ wetKg: shareSum, dryKg: shareSum });
    expect(edgeMass(expected, RUN_ID, PRODUCT_ID)).toEqual({
      wetKg: shareSum, dryKg: shareSum, mass: shareSum, unit: "kg",
    });
    expect(edgeMass(expected, PRODUCT_ID, DELIVERY_ID)).toEqual({
      wetKg: shareSum, dryKg: tonnesToKg(shareSum), mass: shareSum, unit: "tDry",
    });
    // Choose a recorded value whose kg/tonne round trip changes its exact float.
    expect(tonnesToKg(kgToTonnes(recordedDryKg))).not.toBe(recordedDryKg);
    expect(edgeMass(expected, PRODUCT_ID, singleDeliveryId)).toEqual({
      wetKg: recordedDryKg, dryKg: recordedDryKg, mass: kgToTonnes(recordedDryKg), unit: "tDry",
    });
    for (const reordered of [
      [...rollForwards].reverse(),
      [rollForwards[1], rollForwards[2], rollForwards[0]],
      [rollForwards[2], rollForwards[0], rollForwards[1]],
    ]) {
      expect(buildRollForwardMassTotals(reordered)).toEqual(expected);
    }
    expect(rollForwards).toEqual(original);
  });

  it("uses the same nullable sum independently for draws and shipments", () => {
    const missing = forward("run-1", null, NaN);
    missing.products[0].drawnWetMassKg = NaN;
    missing.products[0].drawnDryMassKg = NaN;
    const known = forward("run-2", 0, 0);
    const totals = buildRollForwardMassTotals([missing, known]);
    expect(nodeMass(totals, PRODUCT_ID)).toEqual({ wetKg: 600, dryKg: 570 });
    expect(edgeMass(totals, PRODUCT_ID, DELIVERY_ID)).toEqual({ wetKg: 0, dryKg: 0, mass: 0, unit: "tDry" });
    expect(edgeMass(buildRollForwardMassTotals([missing]), PRODUCT_ID, DELIVERY_ID))
      .toEqual({ ...UNKNOWN, mass: null, unit: "tDry" });
  });

  it("retains a reported wet share alongside an unknown wet share", () => {
    const totals = buildRollForwardMassTotals([forward("run-1", null, 300), forward("run-2", 80, 80)]);
    expect(edgeMass(totals, PRODUCT_ID, DELIVERY_ID)).toEqual({ wetKg: 80, dryKg: 380, mass: 0.38, unit: "tDry" });
  });
});
