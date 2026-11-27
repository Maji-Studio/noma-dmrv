import { describe, expect, it } from "vitest";
import type { DashboardOverview, DashboardStation, DashboardStationKey } from "@/data-access/dashboard-overview";
import { attentionRow } from "../../../tests/helpers/dashboard-attention";
import { facilityListHref } from "@/lib/dashboard-links";
import { ATTENTION_PER_CHECK } from "@/data-access/dashboard-attention";
import { recordHref } from "@/lib/record-links";
import { removalResubmitHref } from "@/lib/removal-correction-copy";
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

function productionGroup(recordIds: string[], href = facilityListHref("/production-runs", "f1", recordIds)) {
  return attentionRow("productionRun", recordIds[0], {
    id: "a4", entityCode: "Production runs", count: recordIds.length, recordIds,
    recordItems: recordIds.slice(0, ATTENTION_PER_CHECK).map((id) => attentionRow("productionRun", id)),
    title: "Missing data", href,
  });
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
    attentionRow("productionRun", "run-1", { id: "a1", entityCode: "PR-1", title: "Run missing data" }),
    attentionRow("productionRun", "run-9", { id: "a2", entityCode: "PR-2", title: "Run in another batch" }),
    attentionRow("creditBatch", "batch-1", { id: "a3", entityCode: "CB-1", title: "Period ended, not submitted yet" }),
    productionGroup(["run-7", "run-8", "run-9"]),
    attentionRow("removal", "removal-1", { id: "a5", entityCode: "RM-1", title: "Couldn't check" }),
    attentionRow("removal", "removal-2", { id: "a6", entityCode: "RM-2", title: "Couldn't check" }),
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

  describe.each(["single", "grouped"] as const)("facility-scoped %s attention", (kind) => {
    const row = kind === "single"
      ? attentionRow("productionRun", "failed-run", { scope: "facility" })
      : { ...productionGroup(["failed-run-1", "failed-run-2", "failed-run-3"]), scope: "facility" as const };

    it.each([{ batchIds: [] }, { batchIds: ["batch-1"] }, { batchIds: ["batch-1", "batch-2"] }])("keeps the complete row under all batches ($batchIds)", ({ batchIds }) => {
      const result = applyBatchScope({ ...overview, attention: [row] }, { ...scope, batchIds }, true);
      expect(result.attention).toEqual([row]);
      expect(result.attentionTotal).toBe(kind === "single" ? 1 : 3);
      const production = result.stations.find((station) => station.key === "production");
      expect(production?.attention).toBe(row.count ?? 1);
      expect(production?.reasons).toEqual([{
        state: "warning",
        text: kind === "single" ? "failed-run: Missing data" : "Production runs: 3 affected, missing data",
        href: row.href,
      }]);
    });

    it.each([{ recordIds: [] }, { recordIds: row.recordIds }])("drops the row under one batch even with overlapping record ids ($recordIds)", ({ recordIds }) => {
      const result = applyBatchScope({ ...overview, attention: [row] }, { ...scope, recordIds }, false);
      expect(result.attention).toEqual([]);
      expect(result.attentionTotal).toBe(0);
      const production = result.stations.find((station) => station.key === "production");
      expect(production?.attention).toBe(0);
      expect(production?.reasons).toEqual([]);
    });
  });

  it("keeps ordinary attention scoping identical under all batches and one batch", () => {
    const source = { ...overview, attention: [...overview.attention, productionGroup(["run-1", "run-2", "run-9"])] };
    const selected = { ...scope, recordIds: [...scope.recordIds, "run-2"] };
    expect(applyBatchScope(source, selected, true)).toEqual(applyBatchScope(source, selected, false));
  });

  it("keeps grouped rows with their scoped count, records in the bubble and a narrowed list link", () => {
    const group = productionGroup(["run-1", "run-2", "run-9"]);
    const result = applyBatchScope({ ...overview, attention: [group] }, { ...scope, recordIds: ["run-1", "run-2"] });
    expect(result.attention).toEqual([{ ...group, href: "/production-runs?facility=f1&ids=run-1,run-2", recordIds: ["run-1", "run-2"], count: 2 }]);
    expect(result.attentionTotal).toBe(2);
    const production = result.stations.find((station) => station.key === "production");
    expect(production?.attention).toBe(2);
    expect(production?.reasons.map((reason) => reason.text)).toEqual(["Production runs: 2 affected, missing data"]);
  });

  it("keeps a grouped link without an ids filter as it is", () => {
    const group = productionGroup(["run-1", "run-2", "run-9"], facilityListHref("/production-runs", "f1"));
    const result = applyBatchScope({ ...overview, attention: [group] }, { ...scope, recordIds: ["run-1", "run-2"] });
    expect(result.attention[0]?.href).toBe(group.href);
  });

  it("drops a grouped row with no in-scope ids even when its href contains a scoped id", () => {
    const group = productionGroup(["run-7", "run-8", "run-9"], facilityListHref("/production-runs", "f1", ["run-1", "run-9"]));
    expect(applyBatchScope({ ...overview, attention: [group] }, scope).attention).toEqual([]);
  });

  it("shows the record's own row, linking to that record, for one scoped id", () => {
    const group = productionGroup(["run-1", "run-8", "run-9"]);
    const single = group.recordItems?.[0];
    const result = applyBatchScope({ ...overview, attention: [group] }, scope);
    expect(result.attention).toEqual([single]);
    expect(result.attentionTotal).toBe(1);
    expect(result.stations.find((station) => station.key === "production")?.attention).toBe(1);
  });

  it("keeps one scoped record grouped when its single row is unavailable", () => {
    const group = productionGroup(["run-7", "run-8", "run-1"]);
    const result = applyBatchScope({ ...overview, attention: [group] }, scope);
    expect(result.attention).toEqual([{
      ...group, count: 1, recordIds: ["run-1"], recordItems: [], href: "/production-runs?facility=f1&ids=run-1",
    }]);
    expect(result.attentionTotal).toBe(1);
    expect(result.stations.find((station) => station.key === "production")?.attention).toBe(1);
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

  it("uses record ids when a single row's link mentions another batch", () => {
    const other = attentionRow("creditBatch", "batch-9", {
      href: recordHref("creditBatch", "batch-9", { facilityId: "f1", focus: "batch-1" }),
    });
    expect(other.href).toContain("batch-1");
    expect(applyBatchScope({ ...overview, attention: [other] }, scope).attention).toEqual([]);
  });

  it.each([
    { stage: "suppliers", recordKind: "supplier" },
    { stage: "feedstock", recordKind: "feedstock" },
    { stage: "production", recordKind: "productionRun" },
    { stage: "products", recordKind: "biocharProduct" },
    { stage: "deliveries", recordKind: "delivery" },
    { stage: "applications", recordKind: "application" },
  ] as const)("assigns rows to $stage using their stage field", ({ stage, recordKind }) => {
    const row = attentionRow(recordKind, "run-1", { href: "/unrelated-destination" });
    const result = applyBatchScope({ ...overview, attention: [row] }, scope);
    expect(result.stations.map((station) => station.attention)).toEqual(KEYS.map((key) => Number(key === stage)));
  });

  it("keeps Production's routed credit batch rows and Removal resume rows", () => {
    const removal = attentionRow("removal", "removal-1", { href: removalResubmitHref("removal-1", "f1") });
    const batch = attentionRow("creditBatch", "batch-1");
    const result = applyBatchScope({ ...overview, attention: [removal, batch] }, scope);
    expect(result.stations.find((station) => station.key === "production")?.attention).toBe(2);
    expect(result.attention).toEqual([removal, batch]);
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

  it("keeps both batches' represented rows when all credit batches are selected", () => {
    const all = applyBatchScope(overview, {
      ...scope, batchIds: ["batch-1", "batch-9"],
      recordIds: ["batch-1", "batch-9", "run-1", "run-9", "removal-1", "removal-2", "run-7", "run-8"],
    });
    expect(all.attention.map((item) => item.id)).toEqual(overview.attention.map((item) => item.id));
    expect(all.attentionTotal).toBe(overview.attention.reduce((sum, item) => sum + (item.count ?? 1), 0));
    expect(all.stations.find((station) => station.key === "production")?.attention).toBe(8);
  });

  it("words the hints for all credit batches when more than one is in scope", () => {
    const all = applyBatchScope(overview, { ...scope, batchIds: ["batch-1", "batch-2"] });
    expect(all.kpis[2]?.hint).toBe("Dry mass of the credit batches' biochar applied to soil.");
  });
});
