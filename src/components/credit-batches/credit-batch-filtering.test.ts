import { describe, expect, it } from "vitest";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { filterCreditBatches } from "./credit-batch-filtering";

const batches = [
  {
    id: "batch-hardwood",
    startDate: "2026-05-01",
    endDate: "2026-05-31",
    feedstockTypeId: "hardwood",
  },
  {
    id: "batch-straw",
    startDate: "2026-06-10",
    endDate: "2026-06-20",
    feedstockTypeId: "straw",
  },
] as CreditBatchWithRelations[];

const healthStates = {
  "batch-hardwood": "ready" as const,
  "batch-straw": "incomplete" as const,
};

describe("filterCreditBatches", () => {
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
