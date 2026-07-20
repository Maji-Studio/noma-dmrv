import { describe, expect, it } from "vitest";
import { createSampleSchema, updateSampleSchema } from "@/schemas/samples";

const validSampleInput = {
  creditBatchId: "00000000-0000-4000-8000-000000000001",
  samplingTime: new Date("2026-01-10T10:00:00.000Z"),
  totalCarbonPercent: 70,
  organicCarbonPercent: 65,
  durabilityOption: "200_year" as const,
};

describe("sample carbon reconciliation", () => {
  it("rejects organic carbon above total carbon", () => {
    const result = createSampleSchema.safeParse({
      ...validSampleInput,
      organicCarbonPercent: 80,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["organicCarbonPercent"],
            message: expect.stringMatching(/organic carbon.*total carbon/i),
          }),
        ]),
      );
    }
  });

  it("rejects organic plus inorganic carbon above total carbon", () => {
    const result = createSampleSchema.safeParse({
      ...validSampleInput,
      organicCarbonPercent: 68,
      inorganicCarbonPercent: 5,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["inorganicCarbonPercent"],
            message: expect.stringMatching(/organic.*inorganic.*total carbon/i),
          }),
        ]),
      );
    }
  });

  it("allows carbon results within the analytical tolerance", () => {
    expect(createSampleSchema.safeParse({
      ...validSampleInput,
      organicCarbonPercent: 70.5,
    }).success).toBe(true);

    expect(createSampleSchema.safeParse({
      ...validSampleInput,
      organicCarbonPercent: 68,
      inorganicCarbonPercent: 2.5,
    }).success).toBe(true);
  });

  it("applies reconciliation when an update supplies all carbon fields", () => {
    const result = updateSampleSchema.safeParse({
      sampleId: "11111111-1111-4111-8111-111111111111",
      totalCarbonPercent: 70,
      organicCarbonPercent: 68,
      inorganicCarbonPercent: 5,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["inorganicCarbonPercent"] }),
        ]),
      );
    }
  });
});
