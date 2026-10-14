import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { buildSubmissionLineageBlockers } from "./certify-lineage-blockers";

const lineage = {
  application: { code: "AP-1" },
  delivery: { code: "DL-1", status: "delivered", customerLocationId: null, distanceKmOverride: null, locationDistanceKm: null },
} as unknown as ChainOfCustodyData;

describe("submission lineage blockers", () => {
  it("reads destination and delivery distance from the existing lineage facts", () => {
    expect(buildSubmissionLineageBlockers([lineage, lineage], [], {})).toEqual([
      "Application AP-1 has no customer location. Select a customer location on the order before submitting.",
      "Delivery DL-1 has no positive transport distance. Set the customer location distance or a delivery distance override before submitting.",
    ]);
    expect(buildSubmissionLineageBlockers([{
      ...lineage, delivery: { ...lineage.delivery, customerLocationId: "location", locationDistanceKm: 10 },
    }], [], {})).toEqual([]);
  });

  it("uses a generic noun when the feedstock code is unavailable", () => {
    const blockers = buildSubmissionLineageBlockers([], ["internal-uuid", "fs-1"], { "fs-1": "FS-1" });
    expect(blockers[0]).toBe("A feedstock has no usable transport leg. Record a positive distance and load mass before submitting.");
    expect(blockers[1]).toContain("Feedstock FS-1");
    expect(blockers.join(" ")).not.toContain("internal-uuid");
  });
});
