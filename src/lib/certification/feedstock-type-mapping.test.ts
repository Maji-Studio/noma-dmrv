import { describe, expect, it } from "vitest";
import type {
  CreditBatchFeedstockTypeFact,
} from "@/data-access/credit-batch-accounting-types";
import { collectFeedstockTypeMappingGaps } from "./feedstock-type-mapping";

function batch(feedstockType: CreditBatchFeedstockTypeFact) {
  return {
    id: "batch-1",
    code: "CB-001",
    feedstockType,
  };
}

function feedstockType(
  overrides: Partial<CreditBatchFeedstockTypeFact> = {},
): CreditBatchFeedstockTypeFact {
  return {
    id: "feedstock-type-1",
    name: "Macadamia shells",
    usage: "pyrolysis",
    isometricFeedstockTypeId: null,
    ...overrides,
  };
}

describe("collectFeedstockTypeMappingGaps", () => {
  it("reports an unmapped pyrolysis feedstock type", () => {
    expect(collectFeedstockTypeMappingGaps([batch(feedstockType())])).toEqual([
      {
        creditBatchId: "batch-1",
        creditBatchCode: "CB-001",
        feedstockTypeId: "feedstock-type-1",
        feedstockTypeName: "Macadamia shells",
      },
    ]);
  });

  it("accepts a mapped pyrolysis feedstock type", () => {
    expect(
      collectFeedstockTypeMappingGaps([
        batch(feedstockType({ isometricFeedstockTypeId: "registry-type-1" })),
      ]),
    ).toEqual([]);
  });

  it("fails closed for an unmapped blend feedstock type", () => {
    expect(
      collectFeedstockTypeMappingGaps([
        batch(feedstockType({ usage: "blend" })),
      ]),
    ).toHaveLength(1);
  });

  it("fails closed when feedstock type usage is null", () => {
    expect(
      collectFeedstockTypeMappingGaps([
        batch(feedstockType({ usage: null })),
      ]),
    ).toHaveLength(1);
  });
});
