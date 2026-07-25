import { describe, expect, it } from "vitest";

import type { getChainOfCustodyData } from "@/data-access/chain-of-custody";
import { factsFromMockedLineages } from "./fixtures/certify-context";

type MockedLineage = Awaited<ReturnType<typeof getChainOfCustodyData>>;

describe("factsFromMockedLineages", () => {
  it("counts a duplicated application once", () => {
    const lineage = {
      facility: { id: "facility-1", code: "FAC-1", name: "Facility" },
      application: {
        id: "application-1",
        code: "APP-1",
        biocharAppliedDryTons: 1.5,
      },
      delivery: { id: "delivery-1" },
      order: null,
      biocharProduct: {
        id: "product-1",
        linkedProductionRunId: "run-1",
      },
      productionRun: { id: "run-1", code: "RUN-1" },
      reactor: null,
      feedstocks: [],
      warnings: [],
    } as unknown as MockedLineage;

    const result = factsFromMockedLineages(
      "batch-1",
      ["run-1"],
      [lineage, lineage],
    );

    expect(result.applications).toHaveLength(1);
    expect(result.applicationIds).toEqual(["application-1"]);
    expect(result.appliedWeightTons).toBe(1.5);
  });
});
