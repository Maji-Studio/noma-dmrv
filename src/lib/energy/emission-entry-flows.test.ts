import { expect, it } from "vitest";
import { emissionEntryFlows } from "./emission-entry-flows";
import { buildEnergyBreakdown } from "./attribution";
import type { LineSources } from "@/lib/isometric/template-observations/line-sources";

const contracts: LineSources = {
  site: { scope: "operating", entryPolicy: "additive", origin: "reviewed", automaticSource: "run-electricity" },
  lab: { scope: "operating", entryPolicy: "additive", origin: "reviewed" },
  diesel: { scope: "operating", entryPolicy: "additive", origin: "reviewed", automaticSource: "run-genset-diesel" },
};
const entry = {
  componentId: "site", kind: "value" as const, counts: true, hasEvidence: false,
  total: { magnitude: "12", unit: "kWh" }, creditBatchId: "batch", occurredOn: "2026-10-15", deletedAt: null,
};
it("adds site electricity and diesel, but never lab electricity", () => {
  expect(emissionEntryFlows([entry, { ...entry, componentId: "lab" },
    { ...entry, componentId: "diesel", total: { magnitude: "3", unit: "L" } }], contracts)).toEqual([
    { source: "grid", creditBatchId: "batch", day: entry.occurredOn, activity: 12 },
    { source: "genset", creditBatchId: "batch", day: entry.occurredOn, activity: 3 },
  ]);
});
it("excludes deleted, non-counting, zero and incompatible-unit entries", () => {
  expect(emissionEntryFlows([
    { ...entry, deletedAt: new Date() }, { ...entry, counts: false }, { ...entry, kind: "zero" },
    { ...entry, unitMismatch: true }, { ...entry, total: { magnitude: "1", unit: "kg" } },
  ], contracts)).toEqual([]);
});
it("converts supported energy scales to kWh", () => {
  expect(emissionEntryFlows([{ ...entry, total: { magnitude: "1000", unit: "Wh" } }], contracts)[0].activity).toBe(1);
});
it("adds entries to facility flows and retains per-batch totals and date filtering", () => {
  const inputs = { runs: [], feedstocks: [], feedstockDraws: [], deliveries: [], deliveryRunShares: [],
    applications: [], applicationRunShares: [], creditBatches: [{ id: "batch", code: "CB", startDate: "2026-10-01", endDate: "2026-10-31", status: "active" }] };
  const period = { from: null, to: "2026-10-31" };
  expect(buildEnergyBreakdown(inputs, period).flows).toEqual([]);
  const result = buildEnergyBreakdown({ ...inputs, emissionEntryFlows: emissionEntryFlows([entry], contracts) }, period);
  expect(result.flows[0].activity).toBe(12);
  expect(result.records[0].footprint.activity.grid).toBe(12);
  expect(result.from).toBe(entry.occurredOn);
  expect(buildEnergyBreakdown({ ...inputs, emissionEntryFlows: emissionEntryFlows([entry], contracts) }, { from: "2026-10-16", to: period.to }).flows).toEqual([]);
});
