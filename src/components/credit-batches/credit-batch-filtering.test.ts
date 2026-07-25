import { describe, expect, it } from "vitest";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import {
  filterCreditBatches,
  readinessErrorWithholdsResults,
  readinessErrorMessage,
} from "./credit-batch-filtering";

const batches = [
  {
    id: "batch-hardwood",
    code: "CB-HARDWOOD",
    startDate: "2026-05-01",
    endDate: "2026-05-31",
    feedstockTypeId: "hardwood",
    feedstockTypeName: "Hardwood chips",
  },
  {
    id: "batch-straw",
    code: "CB-STRAW",
    startDate: "2026-06-10",
    endDate: "2026-06-20",
    feedstockTypeId: "straw",
    feedstockTypeName: "Wheat straw",
  },
] as CreditBatchWithRelations[];

const healthStates = {
  "batch-hardwood": "ready" as const,
  "batch-straw": "incomplete" as const,
};

describe("filterCreditBatches", () => {
  it("searches batch codes and feedstock names case-insensitively", () => {
    const byCode = filterCreditBatches(batches, healthStates, {
      search: "hardwood",
      startDate: "",
      endDate: "",
      feedstockTypeIds: [],
      readiness: "all",
    });
    const byFeedstock = filterCreditBatches(batches, healthStates, {
      search: "WHEAT",
      startDate: "",
      endDate: "",
      feedstockTypeIds: [],
      readiness: "all",
    });

    expect(byCode.map((batch) => batch.id)).toEqual(["batch-hardwood"]);
    expect(byFeedstock.map((batch) => batch.id)).toEqual(["batch-straw"]);
  });

  it("uses production-window overlap for date bounds", () => {
    const result = filterCreditBatches(batches, healthStates, {
      startDate: "2026-05-15",
      endDate: "2026-06-12",
      feedstockTypeIds: [],
      readiness: "all",
    });

    expect(result.map((batch) => batch.id)).toEqual([
      "batch-hardwood",
      "batch-straw",
    ]);
  });

  it("matches any selected feedstock", () => {
    const result = filterCreditBatches(batches, healthStates, {
      startDate: "",
      endDate: "",
      feedstockTypeIds: ["straw"],
      readiness: "all",
    });

    expect(result.map((batch) => batch.id)).toEqual(["batch-straw"]);
  });

  it("filters on certification readiness", () => {
    const result = filterCreditBatches(batches, healthStates, {
      startDate: "",
      endDate: "",
      feedstockTypeIds: [],
      readiness: "needs_attention",
    });

    expect(result.map((batch) => batch.id)).toEqual(["batch-straw"]);
  });
});

describe("readinessErrorWithholdsResults", () => {
  const error = new Error("readiness unavailable");

  it("keeps the loaded list available when readiness is not filtering it", () => {
    expect(readinessErrorWithholdsResults("all", error)).toBe(false);
  });

  it("blocks when an active readiness filter cannot be evaluated", () => {
    expect(readinessErrorWithholdsResults("ready", error)).toBe(true);
    expect(readinessErrorWithholdsResults("needs_attention", error)).toBe(true);
  });

  it("directs operators to retry or clear an unevaluable active filter", () => {
    expect(readinessErrorMessage("ready")).toContain(
      "clear the data-status filter",
    );
  });
});
