import { describe, expect, it } from "vitest";
import { productionRunFormSchema } from "@/schemas/production-runs";

const validProductionRunInput = {
  facilityId: "11111111-1111-4111-8111-111111111111",
  reactorId: "22222222-2222-4222-8222-222222222222",
  status: "running" as const,
  cancellationReason: "",
  startDate: "2026-07-15",
  startTime: "08:00",
  feedstockStorageLocationId: "33333333-3333-4333-8333-333333333333",
  biocharStorageLocationId: "44444444-4444-4444-8444-444444444444",
  feedstockWetMassKg: 100,
  feedstockMoisturePercent: 20,
  biocharOutputKg: 100,
  biocharMoisturePercent: 5,
};

describe("productionRunFormSchema mass balance", () => {
  it("rejects dry biochar output above dry feedstock input", () => {
    const result = productionRunFormSchema.safeParse(validProductionRunInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["biocharOutputKg"],
            message: expect.stringMatching(/dry.*output.*dry.*input/i),
          }),
        ]),
      );
    }
  });

  it("allows dry output equal to dry input within the mass epsilon", () => {
    const result = productionRunFormSchema.safeParse({
      ...validProductionRunInput,
      biocharOutputKg: 80.001,
      biocharMoisturePercent: 0,
    });

    expect(result.success).toBe(true);
  });
});
