import { describe, expect, it } from "vitest";
import { feedstockFormSchema } from "@/schemas/feedstocks";

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
  it("keeps truck weighing masses on valid feedstock intake input", () => {
    const result = feedstockFormSchema.safeParse({
      ...validFeedstockInput,
      truckMassOnArrivalKg: 15_250,
      truckMassOnDepartureKg: 13_750,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.truckMassOnArrivalKg).toBe(15_250);
      expect(result.data.truckMassOnDepartureKg).toBe(13_750);
    }
  });

  it("rejects truck departure mass greater than arrival mass", () => {
    const result = feedstockFormSchema.safeParse({
      ...validFeedstockInput,
      truckMassOnArrivalKg: 13_750,
      truckMassOnDepartureKg: 15_250,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["truckMassOnDepartureKg"],
            message:
              "Truck mass after unloading cannot exceed mass before unloading",
          }),
        ]),
      );
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
});
