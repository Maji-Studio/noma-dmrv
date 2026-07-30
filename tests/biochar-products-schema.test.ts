import { describe, expect, it } from "vitest";
import {
  biocharProductFilterSchema,
  biocharProductFormSchema,
} from "@/schemas/biochar-products";

// productionDate is intentionally absent: a biochar product's production date is
// the selected source bin's oldest allocated run date, derived server-side.
const validBiocharProductInput = {
  facilityId: "11111111-1111-4111-8111-111111111111",
  formulationId: "22222222-2222-4222-8222-222222222222",
  sourceBiocharStorageLocationId:
    "33333333-3333-4333-8333-333333333333",
  storageLocationId: "44444444-4444-4444-8444-444444444444",
  status: "testing",
  massKg: 500,
  moistureContentPercent: 1.5,
  waterAddedKg: 0,
  densityKgM3: null,
};

describe("biocharProductFormSchema", () => {
  it("requires transfer source, measurements, water added, and destination bin", () => {
    const result = biocharProductFormSchema.safeParse({
      ...validBiocharProductInput,
      sourceBiocharStorageLocationId: "",
      storageLocationId: "",
      massKg: null,
      moistureContentPercent: null,
      waterAddedKg: null,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issuePaths = result.error.issues.map((issue) => issue.path.join("."));
      const issueMessages = new Map(
        result.error.issues.map((issue) => [
          issue.path.join("."),
          issue.message,
        ]),
      );
      expect(issuePaths).toContain("sourceBiocharStorageLocationId");
      expect(issuePaths).toContain("storageLocationId");
      expect(issuePaths).toContain("massKg");
      expect(issuePaths).toContain("moistureContentPercent");
      expect(issuePaths).toContain("waterAddedKg");
      expect(issueMessages.get("massKg")).toBe("Wet mass is required");
      expect(issueMessages.get("moistureContentPercent")).toBe("Required");
      expect(issueMessages.get("waterAddedKg")).toBe("Required");
    }
  });

  it("accepts zero water added as an explicit required value", () => {
    const result = biocharProductFormSchema.safeParse(validBiocharProductInput);

    expect(result.success).toBe(true);
  });

  it("rejects precision that exact numeric storage would round", () => {
    const result = biocharProductFormSchema.safeParse({
      ...validBiocharProductInput,
      massKg: 1041.6667,
      moistureContentPercent: 1.1234567,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["massKg"] }),
          expect.objectContaining({ path: ["moistureContentPercent"] }),
        ]),
      );
    }
  });

  it("accepts values at the persisted mass and percent scales", () => {
    expect(
      biocharProductFormSchema.safeParse({
        ...validBiocharProductInput,
        massKg: 1041.667,
        moistureContentPercent: 1.123456,
      }).success,
    ).toBe(true);
  });

  it("ignores a productionDate field because source allocation derives it", () => {
    const result = biocharProductFormSchema.safeParse({
      ...validBiocharProductInput,
      productionDate: "2026-01-18",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("productionDate");
    }
  });
});

describe("biocharProductFilterSchema", () => {
  it("accepts a credit-batch deep-link filter", () => {
    const creditBatchId = "55555555-5555-4555-8555-555555555555";
    const result = biocharProductFilterSchema.parse({ creditBatchId });

    expect(result.creditBatchId).toBe(creditBatchId);
  });
});
