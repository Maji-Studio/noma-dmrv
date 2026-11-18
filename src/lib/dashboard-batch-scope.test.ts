import { describe, expect, it } from "vitest";
import type {
  BatchLineageApplicationFact,
  BatchLineageFeedstockFact,
  BatchLineageRunFact,
  BatchRunForwardProductFact,
  CreditBatchLineageFacts,
} from "@/data-access/credit-batch-lineage-types";
import { projectDashboardBatchScope } from "./dashboard-batch-scope";

const feedstock = (id: string, supplierId: string | null = "supplier-1"): BatchLineageFeedstockFact => ({
  id, supplierId, supplierName: "Supplier", code: id, status: null,
  deliveryDate: null, massDryKg: null, wetMassUsedKg: null,
  ownsTransport: false, feedstockTypeName: null,
});
const run = (id = "run-1"): BatchLineageRunFact => ({
  id, code: id, status: null, date: "2026-01-01",
  feedstockMassDryKg: 2_000, biocharDryMassKg: 500,
  reactor: { id: "reactor-1", code: "R", identifier: "R", reactorType: null },
  feedstocks: [feedstock("feedstock-1")],
});
const application = (id = "application-1", dryTons: number | null = 0.2, runId = "run-1"): BatchLineageApplicationFact => ({
  id, code: id, status: null, applicationDate: new Date("2026-01-01"),
  fieldIdentifier: null, evidenceMethod: "location", gisBoundary: null,
  biocharAppliedTons: 0.3, biocharAppliedDryTons: dryTons,
  sourceAllocation: { productionRunId: runId, allocatedWetMassKg: 300, allocatedDryMassKg: 200 }, soilTemperatureC: null,
  facility: { id: "facility-1", code: "F", name: "Facility" },
  delivery: { id: "delivery-1", code: "D", status: null, deliveryDate: new Date("2026-01-01"), massDryKg: null, proofOfDeliveryCount: 0 },
  order: { id: "order-1", code: "O", orderDate: new Date("2026-01-01"), quantityKg: null },
  biocharProduct: { id: "product-1", code: "P", status: null, productionDate: "2026-01-01", massKg: null, moistureContentPercent: null, formulationName: null, linkedProductionRunId: runId },
});
const product = (): BatchRunForwardProductFact => ({
  id: "stocked-product", code: "P", status: null, productionDate: "2026-01-01",
  massKg: 100, moistureContentPercent: 0, formulationName: null,
  drawnWetMassKg: 100, drawnDryMassKg: 100,
  deliveries: [{ id: "forward-delivery", code: "D", status: null, deliveryDate: new Date("2026-01-01"), deliveredWetMassKg: 100, massDryKg: 100, wetMassKg: 100, dryMassKg: 100 }],
});
const facts = (batchId = "batch-1", runs = [run()], applications = [application()]): CreditBatchLineageFacts => ({
  batchId, runs, applications, productionRunIds: runs.map(({ id }) => id),
  applicationIds: applications.map(({ id }) => id), appliedWeightTons: 0,
  runForwards: Object.fromEntries(runs.map(({ id }) => [id, [product()]])),
});
const scoped = (lineageFacts = facts(), co2eStoredTonnes: number | null = 1) => ({ lineageFacts, co2eStoredTonnes });

describe("projectDashboardBatchScope", () => {
  it("unions distinct batch runs sharing an application, feedstock, product and delivery", () => {
    const first = facts();
    const second = facts("batch-2", [run("run-2")], [application("application-1", 0.2, "run-2")]);
    const result = projectDashboardBatchScope([scoped(first), scoped(second, 2)]);
    expect(first.applications[0]?.sourceAllocation?.productionRunId).toBe("run-1");
    expect(second.applications[0]?.sourceAllocation?.productionRunId).toBe("run-2");
    expect(result.batchIds).toEqual(["batch-1", "batch-2"]);
    expect(result.stationTotals).toEqual({ suppliers: 1, feedstock: 1, production: 2, products: 2, deliveries: 2, applications: 1 });
    // The shared application is split across both batches: one application, two 0.2 t slices.
    expect(result.kpis).toEqual({ feedstockProcessedDryTonnes: 4, biocharProducedDryTonnes: 1, appliedToSoilDryTonnes: 0.4, co2eStoredTonnes: 3 });
    expect(result.recordIds).toEqual([
      "application-1", "batch-1", "batch-2", "delivery-1", "feedstock-1",
      "forward-delivery", "order-1", "product-1", "reactor-1", "run-1", "run-2", "stocked-product",
    ]);
  });

  it("includes unapplied products and deliveries from roll-forwards", () => {
    const result = projectDashboardBatchScope([scoped(facts("batch-1", [run()], []))]);
    expect(result.stationTotals).toMatchObject({ production: 1, products: 1, deliveries: 1, applications: 0 });
    expect(result.kpis.appliedToSoilDryTonnes).toBe(0);
    expect(result.recordIds).toContain("stocked-product");
  });

  it("returns the specified empty-facility values", () => {
    expect(projectDashboardBatchScope([])).toEqual({
      batchIds: [], recordIds: [],
      stationTotals: { suppliers: 0, feedstock: 0, production: 0, products: 0, deliveries: 0, applications: 0 },
      kpis: { feedstockProcessedDryTonnes: null, biocharProducedDryTonnes: null, appliedToSoilDryTonnes: 0, co2eStoredTonnes: null },
    });
  });

  it("keeps empty batches in scope and applies the CO₂e all-or-null rule", () => {
    expect(projectDashboardBatchScope([scoped(), scoped(facts("batch-2", [], []), null)]).kpis.co2eStoredTonnes).toBeNull();
    expect(projectDashboardBatchScope([scoped(facts("batch-1", [], []), null)]).recordIds).toEqual(["batch-1"]);
    expect(projectDashboardBatchScope([scoped(facts(), 0)]).kpis.co2eStoredTonnes).toBe(0);
    expect(projectDashboardBatchScope([scoped(), scoped()]).kpis.co2eStoredTonnes).toBe(1);
  });

  it("sums reported run measurements, ignoring null and non-finite values", () => {
    const unknown = { ...run("unknown"), feedstockMassDryKg: null, biocharDryMassKg: Number.NaN };
    const zero = { ...run("zero"), feedstockMassDryKg: 0, biocharDryMassKg: 0 };
    expect(projectDashboardBatchScope([scoped(facts("batch-1", [unknown], []))]).kpis).toMatchObject({ feedstockProcessedDryTonnes: null, biocharProducedDryTonnes: null });
    expect(projectDashboardBatchScope([scoped(facts("batch-1", [unknown, zero], []))]).kpis).toMatchObject({ feedstockProcessedDryTonnes: 0, biocharProducedDryTonnes: 0 });
    expect(projectDashboardBatchScope([scoped(facts("batch-1", [unknown, run()], []))]).kpis).toMatchObject({ feedstockProcessedDryTonnes: 2, biocharProducedDryTonnes: 0.5 });
  });

  it("distinguishes no applications, unknown applied mass, measured zero and partial reporting", () => {
    const applied = (apps: BatchLineageApplicationFact[]) => projectDashboardBatchScope([scoped(facts("batch-1", [run()], apps))]).kpis.appliedToSoilDryTonnes;
    expect(applied([])).toBe(0);
    expect(applied([application("unknown", null)])).toBeNull();
    expect(applied([application("zero", 0)])).toBe(0);
    expect(applied([application("unknown", null), application()])).toBe(0.2);
    expect(applied([application("invalid", Infinity)])).toBeNull();
  });

  it("dedupes suppliers by id even with identical names, falling back to names", () => {
    const source = { ...run(), feedstocks: [
      feedstock("one"), feedstock("two"), feedstock("three", "supplier-2"),
      feedstock("four", null), feedstock("five", null),
      { ...feedstock("six", null), supplierName: null },
    ] };
    expect(projectDashboardBatchScope([scoped(facts("batch-1", [source], []))]).stationTotals).toMatchObject({ suppliers: 3, feedstock: 6 });
  });
});
