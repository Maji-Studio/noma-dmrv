import { describe, expect, it } from "vitest";
import { biocharProductFormSchema } from "@/schemas/biochar-products";
import { formatLocalDate } from "@/lib/date-utils";

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

  // #46 — date-only input must parse at LOCAL midnight; `new Date("YYYY-MM-DD")`
  // parses at UTC midnight, which shifted the stored date back one day per
  // edit/save round-trip for users west of UTC.
  describe("productionDate", () => {
    it("parses date-only input at local midnight", () => {
      const result = biocharProductFormSchema.safeParse(validBiocharProductInput);

      expect(result.success).toBe(true);
      if (result.success) {
        const date = result.data.productionDate!;
        expect(date).toBeInstanceOf(Date);
        expect(date.getFullYear()).toBe(2026);
        expect(date.getMonth()).toBe(0);
        expect(date.getDate()).toBe(18);
        expect(date.getHours()).toBe(0);
      }
    });

    it("round-trips through the edit form's local date formatting without shifting a day", () => {
      const result = biocharProductFormSchema.safeParse(validBiocharProductInput);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(formatLocalDate(result.data.productionDate!)).toBe("2026-01-18");
      }
    });

    it("treats empty string as undefined and passes Date values through", () => {
      const emptyResult = biocharProductFormSchema.safeParse({
        ...validBiocharProductInput,
        productionDate: "",
      });
      expect(emptyResult.success).toBe(true);
      if (emptyResult.success) {
        expect(emptyResult.data.productionDate).toBeUndefined();
      }

      const existing = new Date(2026, 2, 5);
      const dateResult = biocharProductFormSchema.safeParse({
        ...validBiocharProductInput,
        productionDate: existing,
      });
      expect(dateResult.success).toBe(true);
      if (dateResult.success) {
        expect(dateResult.data.productionDate).toBe(existing);
      }
    });
  });
});
