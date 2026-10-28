import { describe, expect, it } from "vitest";
import { RECORD_LINKS, recordHref, type RecordKind } from "./record-links";
import { ENTITY_FOCUS_TARGETS } from "./entity-deep-link";

// Literal expected routes catch drift in both the table and its query readers.
const CASES = [
  ["feedstock", "/feedstock-intake", "feedstock"],
  ["productionRun", "/production-runs", "run"],
  ["biocharProduct", "/biochar-products", "biocharProduct"],
  ["order", "/orders", "order"],
  ["delivery", "/deliveries", "delivery"],
  ["application", "/applications", "application"],
  ["creditBatch", "/credit-batches/record%2F1", null],
  ["sample", "/lab-samples", "sample"],
  ["removal", "/removals", "removal"],
  ["ghgStatement", "/ghg-statements", "statement"],
  ["supplier", "/suppliers/record%2F1", null],
  ["customer", "/customers/record%2F1", null],
  ["feedstockType", "/feedstock-types", "feedstockType"],
  ["storageBin", "/storage-bins", "storageLocation"],
  ["vehicle", "/vehicles", "vehicle"],
  ["driver", "/crew", "driver"],
  ["operator", "/crew", "operator"],
] as const satisfies ReadonlyArray<readonly [RecordKind, string, string | null]>;

describe("recordHref", () => {
  it("covers every record kind", () => {
    expect(CASES.map(([kind]) => kind).sort()).toEqual(Object.keys(RECORD_LINKS).sort());
  });

  it.each(CASES)("opens %s with and without facility, encoding both ids", (kind, path, param) => {
    const recordQuery = param ? `${param}=record%2F1` : "";
    expect(recordHref(kind, "record/1")).toBe(`${path}${recordQuery ? `?${recordQuery}` : ""}`);
    expect(recordHref(kind, "record/1", { facilityId: "facility 1" })).toBe(
      `${path}?facility=facility+1${recordQuery ? `&${recordQuery}` : ""}`,
    );
    expect(recordHref(kind, "record/1", { facilityId: null })).toBe(recordHref(kind, "record/1"));
    expect(recordHref(kind, "record/1", { facilityId: "" })).toBe(recordHref(kind, "record/1"));
  });

  it("keeps credit batch overview implicit and orders tab and focus after facility", () => {
    expect(recordHref("creditBatch", "batch/1", { tab: "overview" })).toBe("/credit-batches/batch%2F1");
    expect(recordHref("creditBatch", "batch/1", { facilityId: "f 1", tab: "emissions", focus: "row/1" }))
      .toBe("/credit-batches/batch%2F1?facility=f+1&tab=emissions&focus=row%2F1");
    expect(recordHref("creditBatch", "batch/1", { focus: ENTITY_FOCUS_TARGETS.removalTemplate }))
      .toBe("/credit-batches/batch%2F1?focus=removal-template");
  });

  it("opens the credit batch list preview explicitly", () => {
    expect(recordHref("creditBatch", "b/1", { preview: true })).toBe("/credit-batches?batch=b%2F1");
    expect(recordHref("creditBatch", "b/1", { facilityId: "f 1", preview: true }))
      .toBe("/credit-batches?facility=f+1&batch=b%2F1");
  });

  it.each(["production", "samples", "emissions", "removals", "activities"] as const)("opens the credit batch %s tab", (tab) => {
    expect(recordHref("creditBatch", "b/1", { tab })).toBe(`/credit-batches/b%2F1?tab=${tab}`);
    expect(recordHref("creditBatch", "b/1", { facilityId: "f 1", tab }))
      .toBe(`/credit-batches/b%2F1?facility=f+1&tab=${tab}`);
  });

  it.each(Object.values(ENTITY_FOCUS_TARGETS))("keeps edit mode and the %s focus target", (focus) => {
    expect(recordHref("feedstock", "fs/1", { facilityId: "f 1", mode: "edit", focus }))
      .toBe(`/feedstock-intake?facility=f+1&feedstock=fs%2F1&mode=edit&focus=${focus}`);
    expect(recordHref("feedstockType", "type/1", { facilityId: "f 1", mode: "edit" }))
      .toBe("/feedstock-types?facility=f+1&feedstockType=type%2F1&mode=edit");
  });

  it.each(["supplier", "customer"] as const)("preserves the %s list's location edit intent", (kind) => {
    expect(recordHref(kind, "party/1", { facilityId: "f 1", preview: true, mode: "edit", locationId: "loc/1" }))
      .toBe(`${RECORD_LINKS[kind].path}?facility=f+1&${kind}=party%2F1&mode=edit&location=loc%2F1`);
  });
});
