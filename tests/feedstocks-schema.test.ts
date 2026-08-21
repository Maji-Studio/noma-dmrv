import { describe, expect, it } from "vitest";
import { feedstockFormSchema, updateFeedstockSchema } from "@/schemas/feedstocks";

const validFeedstockInput = {
  facilityId: "11111111-1111-4111-8111-111111111111",
  deliveryDate: "2026-01-18",
  supplierId: "22222222-2222-4222-8222-222222222222",
  vehicleId: null,
  transportDistanceKm: null,
  feedstockTypeId: "33333333-3333-4333-8333-333333333333",
  totalWetMassKg: 1500,
  moisturePercent: 35,
  allocations: [
    {
      storageLocationId: "44444444-4444-4444-8444-444444444444",
      allocatedWetMassKg: 1500,
    },
  ],
  overrideJustification: "",
  notes: "",
};

describe("feedstockFormSchema", () => {
  it("accepts valid feedstock intake input", () => {
    const result = feedstockFormSchema.safeParse(validFeedstockInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalWetMassKg).toBe(1500);
    }
  });

  it("uses friendly required messages for required number fields", () => {
    const result = feedstockFormSchema.safeParse({
      ...validFeedstockInput,
      totalWetMassKg: null,
      moisturePercent: null,
      allocations: [
        {
          ...validFeedstockInput.allocations[0],
          allocatedWetMassKg: null,
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issueMessages = new Map(
        result.error.issues.map((issue) => [
          issue.path.join("."),
          issue.message,
        ]),
      );
      expect(issueMessages.get("totalWetMassKg")).toBe("Required");
      expect(issueMessages.get("moisturePercent")).toBe("Required");
      expect(issueMessages.get("allocations.0.allocatedWetMassKg")).toBe(
        "Required",
      );
    }
  });

  it("rejects a zero-mass delivery and zero-mass bin allocation", () => {
    const result = feedstockFormSchema.safeParse({
      ...validFeedstockInput,
      totalWetMassKg: 0,
      allocations: [
        {
          ...validFeedstockInput.allocations[0],
          allocatedWetMassKg: 0,
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issueMessages = new Map(
        result.error.issues.map((issue) => [
          issue.path.join("."),
          issue.message,
        ]),
      );
      expect(issueMessages.get("totalWetMassKg")).toBe("Must be greater than 0");
      expect(issueMessages.get("allocations.0.allocatedWetMassKg")).toBe(
        "Must be greater than 0",
      );
    }
  });

  it("rejects a zero wet mass on the update action but allows omitting it", () => {
    const feedstockId = "55555555-5555-4555-8555-555555555555";
    const result = updateFeedstockSchema.safeParse({
      feedstockId,
      massWetKg: 0,
      massDryKg: 0,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issueMessages = new Map(
        result.error.issues.map((issue) => [
          issue.path.join("."),
          issue.message,
        ]),
      );
      expect(issueMessages.get("massWetKg")).toBe("Must be greater than 0");
      // Dry mass is derived, so a 100% moisture intake stays valid at zero.
      expect(issueMessages.has("massDryKg")).toBe(false);
    }

    expect(
      updateFeedstockSchema.safeParse({ feedstockId, notes: "Scale recheck" })
        .success,
    ).toBe(true);
    expect(
      updateFeedstockSchema.safeParse({
        feedstockId,
        massWetKg: 1500,
        massDryKg: 0,
      }).success,
    ).toBe(true);
  });

  it("requires a justification when allocations exceed the declared wet mass", () => {
    const result = feedstockFormSchema.safeParse({
      ...validFeedstockInput,
      totalWetMassKg: 2000,
      allocations: [
        {
          ...validFeedstockInput.allocations[0],
          allocatedWetMassKg: 2100,
        },
      ],
      overrideJustification: "   ",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["overrideJustification"],
            message: expect.stringMatching(/justification/i),
          }),
        ]),
      );
    }
  });

  it("allows a justified over-allocation and comparison epsilon", () => {
    expect(feedstockFormSchema.safeParse({
      ...validFeedstockInput,
      totalWetMassKg: 1000,
      allocations: [{
        ...validFeedstockInput.allocations[0],
        allocatedWetMassKg: 1100,
      }],
      overrideJustification: "Scale reconciliation pending",
    }).success).toBe(true);

    expect(feedstockFormSchema.safeParse({
      ...validFeedstockInput,
      totalWetMassKg: 1000,
      allocations: [{
        ...validFeedstockInput.allocations[0],
        allocatedWetMassKg: 1000.001,
      }],
      overrideJustification: "",
    }).success).toBe(true);
  });
});
