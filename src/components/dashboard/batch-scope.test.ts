import { describe, expect, it } from "vitest";
import type { DashboardOverview, DashboardStation, DashboardStationKey } from "@/data-access/dashboard-overview";
import { applyBatchScope, type DashboardBatchScopeView } from "./batch-scope";

const KEYS: DashboardStationKey[] = ["suppliers", "feedstock", "production", "products", "deliveries", "applications"];
const LIST: Record<DashboardStationKey, string> = {
  suppliers: "/suppliers",
  feedstock: "/feedstock-intake",
  production: "/production-runs",
  products: "/biochar-products",
  deliveries: "/deliveries",
  applications: "/applications",
};

function station(key: DashboardStationKey): DashboardStation {
  return { key, name: key, total: 99, totalLabel: "99 things", attention: 7, reasons: [], href: `${LIST[key]}?facility=f1` };
}

const overview = {
  range: "all",
  generatedAt: "2026-11-09T12:00:00Z",
  kpis: [
    { key: "feedstockProcessed", label: "Feedstock processed", unit: "t", value: 50, deltaPercent: 5, detail: "x" },
    { key: "biocharProduced", label: "Biochar produced", unit: "t", value: 20, deltaPercent: 5, detail: "x" },
    { key: "appliedToSoil", label: "Applied to soil", unit: "t", value: 10, deltaPercent: 5, detail: "x" },
    { key: "co2eStored", label: "Estimated CO₂e stored", unit: "t", value: 30, deltaPercent: 5, detail: "x" },
  ],
  stations: KEYS.map(station),
  massFlow: [],
  runningRuns: 0,
  certification: {},
  structuralGaps: [{ key: "gap" }],
  attentionTotal: 6,
  attention: [
    { id: "a1", entityCode: "PR-1", date: null, title: "Run missing data", href: "/production-runs?facility=f1&id=run-1" },
    { id: "a2", entityCode: "PR-2", date: null, title: "Run in another batch", href: "/production-runs?facility=f1&id=run-9" },
    { id: "a3", entityCode: "CB-1", date: null, title: "Period ended, not submitted yet", href: "/credit-batches/batch-1?facility=f1" },
    { id: "a4", entityCode: "Production runs", count: 3, date: null, title: "Missing data", href: "/production-runs?facility=f1" },
    { id: "a5", entityCode: "RM-1", date: null, title: "Couldn't check", href: "/removals?facility=f1&removal=removal-1" },
    { id: "a6", entityCode: "RM-2", date: null, title: "Couldn't check", href: "/removals?facility=f1&removal=removal-2" },
  ],
  activity: [
    { id: "x1", code: "PR-1", title: "Run saved", dateIso: "2026-11-09T10:00:00Z", href: "/production-runs?id=run-1" },
    { id: "x2", code: "PR-9", title: "Other run saved", dateIso: "2026-11-09T09:00:00Z", href: "/production-runs?id=run-9" },
  ],
} as unknown as DashboardOverview;

const scope: DashboardBatchScopeView = {
  activity: [{ id: "older-scoped", code: "PR-1", title: "Run saved", dateIso: "2026-01-01T10:00:00Z", href: "/production-runs?id=run-1" }],
  batchIds: ["batch-1"],
  downstreamComplete: true,
  stationTotals: { suppliers: 1, feedstock: 2, production: 3, products: 0, deliveries: 1, applications: 1 },
  kpis: { feedstockProcessedDryTonnes: 2.4, biocharProducedDryTonnes: null, appliedToSoilDryTonnes: 0, co2eStoredTonnes: 4.5 },
  recordIds: ["batch-1", "removal-1", "run-1"],
};

describe("applyBatchScope", () => {
  const scoped = applyBatchScope(overview, scope);
  const byKey = (key: DashboardStationKey) => scoped.stations.find((item) => item.key === key)!;

  it("takes the stage counts and labels from the scope", () => {
    expect(byKey("production").total).toBe(3);
    expect(byKey("production").totalLabel).toBe("3 runs");
    expect(byKey("products").totalLabel).toBe("0 products");
    expect(byKey("suppliers").totalLabel).toBe("1 supplier");
    expect(byKey("feedstock").totalLabel).toBe("2 feedstocks");
    expect(byKey("deliveries").totalLabel).toBe("1 delivery");
    expect(byKey("applications").totalLabel).toBe("1 application");
  });

  it("keeps only in-scope To do and activity rows and drops unscoped grouped rows and gaps", () => {
    expect(scoped.attention.map((item) => item.id)).toEqual(["a1", "a3", "a5"]);
    expect(scoped.structuralGaps).toEqual([]);
    expect(scoped.attentionTotal).toBe(3);
    expect(scoped.activity.map((item) => item.id)).toEqual(["older-scoped"]);
  });

  it("keeps grouped rows with their scoped count, records in the bubble and a narrowed list link", () => {
    const group = { ...overview.attention[3], recordIds: ["run-1", "run-2", "run-9"], href: "/production-runs?facility=f1&ids=run-1,run-2,run-9" };
    const result = applyBatchScope({ ...overview, attention: [group] }, { ...scope, recordIds: ["run-1", "run-2"] });
    expect(result.attention).toEqual([{ ...group, href: "/production-runs?facility=f1&ids=run-1,run-2", recordIds: ["run-1", "run-2"], count: 2 }]);
    expect(result.attentionTotal).toBe(1);
    const production = result.stations.find((station) => station.key === "production");
    expect(production?.attention).toBe(2);
    expect(production?.reasons.map((reason) => reason.text)).toEqual(["Production runs: 2 affected, missing data"]);
  });

  it("keeps a grouped link without an ids filter as it is", () => {
    const group = { ...overview.attention[3], recordIds: ["run-1", "run-2", "run-9"] };
    const result = applyBatchScope({ ...overview, attention: [group] }, { ...scope, recordIds: ["run-1", "run-2"] });
    expect(result.attention[0]?.href).toBe(group.href);
  });

  it("drops a grouped row with no in-scope ids even when its href contains a scoped id", () => {
    const group = { ...overview.attention[3], recordIds: ["run-9"], href: "/production-runs?ids=run-1,run-9" };
    expect(applyBatchScope({ ...overview, attention: [group] }, scope).attention).toEqual([]);
  });

  it("shows the record's own row, linking to that record, for one scoped id", () => {
    const single = { ...overview.attention[0], recordIds: ["run-1"] };
    const group = { ...overview.attention[3], recordIds: ["run-1", "run-9"], recordItems: [single] };
    expect(applyBatchScope({ ...overview, attention: [group] }, scope).attention).toEqual([single]);
  });

  it("keeps one scoped record grouped when its single row is unavailable", () => {
    const group = { ...overview.attention[3], recordIds: ["run-1", "run-9"] };
    expect(applyBatchScope({ ...overview, attention: [group] }, scope).attention).toEqual([{ ...group, count: 1, recordIds: ["run-1"] }]);
  });

  it("counts in-scope credit batch and Removal rows on the Production bubble with the stage's own rows", () => {
    expect(byKey("production").attention).toBe(3);
    expect(byKey("production").reasons.map((reason) => reason.text)).toEqual([
      "PR-1: Run missing data",
      "CB-1: Period ended, not submitted yet",
      "RM-1: Couldn't check",
    ]);
    expect(byKey("feedstock").attention).toBe(0);
  });

  it("carries the four KPI figures, a true zero and an unknown, with scope hints", () => {
    const [feedstock, biochar, applied, co2e] = scoped.kpis;
    expect(feedstock?.value).toBe(2.4);
    expect(biochar?.value).toBeNull();
    expect(applied?.value).toBe(0);
    expect(co2e?.value).toBe(4.5);
    expect(feedstock?.hint).toBe("Dry feedstock mass into this credit batch's production runs.");
    expect(scoped.kpis.every((kpi) => kpi.deltaPercent === null)).toBe(true);
  });

  it("words the hints for all credit batches when more than one is in scope", () => {
    const all = applyBatchScope(overview, { ...scope, batchIds: ["batch-1", "batch-2"] });
    expect(all.kpis[2]?.hint).toBe("Dry mass of the credit batches' biochar applied to soil.");
  });
});
