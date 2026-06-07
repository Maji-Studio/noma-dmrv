import { describe, expect, it } from "vitest";
import { biocharProductFormSchema } from "@/schemas/biochar-products";

const validBiocharProductInput = {
  facilityId: "11111111-1111-4111-8111-111111111111",
  formulationId: "22222222-2222-4222-8222-222222222222",
  linkedProductionRunId: "33333333-3333-4333-8333-333333333333",
  storageLocationId: "44444444-4444-4444-8444-444444444444",
  productionDate: "2026-01-18",
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
      linkedProductionRunId: "",
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
      expect(issuePaths).toContain("linkedProductionRunId");
      expect(issuePaths).toContain("storageLocationId");
      expect(issuePaths).toContain("massKg");
      expect(issuePaths).toContain("moistureContentPercent");
      expect(issuePaths).toContain("waterAddedKg");
      expect(issueMessages.get("massKg")).toBe("Required");
      expect(issueMessages.get("moistureContentPercent")).toBe("Required");
      expect(issueMessages.get("waterAddedKg")).toBe("Required");
    }
  });

  it("accepts zero water added as an explicit required value", () => {
    const result = biocharProductFormSchema.safeParse(validBiocharProductInput);

    expect(result.success).toBe(true);
  });
});
