import { describe, expect, it } from "vitest";
import { isCreateIntentValue } from "./create-intent";
import { ADD_STOCK_BIN_PARAM, addStockBinId, addStockHref, resolveAddStockBin } from "./add-stock-intent";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";
const BIN_ID = "22222222-2222-4222-8222-222222222222";
const productBin = { id: BIN_ID, type: "product_bin", facilityId: FACILITY_ID, formulationId: "f1", archivedAt: null };

describe("addStockHref", () => {
  it("opens the create form of what fills the bin, naming the bin", () => {
    const product = new URL(addStockHref("product", FACILITY_ID, BIN_ID), "http://localhost");
    expect(product.pathname).toBe("/biochar-products");
    expect(isCreateIntentValue(product.searchParams.get("create"))).toBe(true);
    expect(product.searchParams.get("facility")).toBe(FACILITY_ID);
    expect(product.searchParams.get(ADD_STOCK_BIN_PARAM)).toBe(BIN_ID);
    expect(new URL(addStockHref("biochar", FACILITY_ID, BIN_ID), "http://localhost").pathname).toBe("/production-runs");
  });
});

describe("addStockBinId", () => {
  it("passes a bin id and drops anything else before any lookup", () => {
    expect(addStockBinId(BIN_ID)).toBe(BIN_ID);
    expect(addStockBinId("not-a-bin")).toBeNull();
    expect(addStockBinId(null)).toBeNull();
  });
});

describe("resolveAddStockBin", () => {
  it("keeps a bin of the kind the form fills in the form's facility, with its formulation", () => {
    expect(resolveAddStockBin(productBin, "product", FACILITY_ID)).toEqual({ storageLocationId: BIN_ID, formulationId: "f1" });
    expect(resolveAddStockBin({ ...productBin, type: "biochar_bin", formulationId: null }, "biochar", FACILITY_ID)).toEqual({ storageLocationId: BIN_ID, formulationId: null });
  });

  it("opens with no bin for another kind of bin, another facility, an archived bin or no bin", () => {
    expect(resolveAddStockBin(productBin, "biochar", FACILITY_ID)).toBeNull();
    expect(resolveAddStockBin(productBin, "product", "33333333-3333-4333-8333-333333333333")).toBeNull();
    expect(resolveAddStockBin({ ...productBin, archivedAt: "2026-10-01T00:00:00.000Z" }, "product", FACILITY_ID)).toBeNull();
    expect(resolveAddStockBin(undefined, "product", FACILITY_ID)).toBeNull();
    expect(resolveAddStockBin(productBin, "product", null)).toBeNull();
  });
});
