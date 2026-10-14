import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { buildSubmissionLineageBlockers } from "./certify-lineage-blockers";

const lineage = {
  application: { id: "app-1", code: "AP-1" },
  order: { id: "order-1", code: "OR-1" },
  delivery: { id: "delivery-1", code: "DL-1", status: "delivered", customerLocationId: null, distanceKmOverride: null, locationDistanceKm: null },
} as unknown as ChainOfCustodyData;

describe("submission lineage blockers", () => {
  it("reads destination and delivery distance from the existing lineage facts", () => {
    expect(buildSubmissionLineageBlockers([lineage, lineage], [], {}, ["biochar"]).map((blocker) => blocker.detail)).toEqual([
      "Application AP-1 has no customer location. Select a customer location on the order before submitting.",
      "Delivery DL-1 has no positive transport distance. Set the customer location distance or a delivery distance override before submitting.",
    ]);
    expect(buildSubmissionLineageBlockers([lineage], [], {}, ["biochar"])).toMatchObject([
      { fixTarget: "orders", record: { id: "order-1", code: "OR-1" } },
      { fixTarget: "deliveryDistances", record: { id: "delivery-1", code: "DL-1" } },
    ]);
    expect(buildSubmissionLineageBlockers([{
      ...lineage, delivery: { ...lineage.delivery, customerLocationId: "location", locationDistanceKm: 10 },
    }], [], {}, ["biochar"])).toEqual([]);
  });

  it("uses a generic noun when the feedstock code is unavailable", () => {
    const blockers = buildSubmissionLineageBlockers([], ["internal-uuid", "fs-1"], { "fs-1": "FS-1" }, ["feedstock"]);
    expect(blockers[0].detail).toBe("A feedstock has no usable transport leg. Record a positive distance and load mass before submitting.");
    expect(blockers[1]).toMatchObject({ fixTarget: "feedstocks", record: { id: "fs-1", code: "FS-1" } });
    expect(blockers[1].detail).toContain("Feedstock FS-1");
    expect(blockers.map((blocker) => blocker.detail).join(" ")).not.toContain("internal-uuid");
  });
});
