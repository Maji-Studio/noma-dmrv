import { describe, expect, it } from "vitest";
import { storageLocationQuickAddSchema } from "./quick-add";
import {
  formatStorageLocationType,
  storageLocationFormSchema,
} from "./storage-locations";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const RELATED_ID = "00000000-0000-4000-8000-000000000002";

describe("formatStorageLocationType", () => {
  it("uses sentence case for operator-facing bin types", () => {
    expect(formatStorageLocationType("feedstock_bin")).toBe("Feedstock bin");
    expect(formatStorageLocationType("biochar_bin")).toBe("Biochar bin");
    expect(formatStorageLocationType("product_bin")).toBe("Product bin");
  });
});

describe("storage-bin validation copy", () => {
  it("uses visible concepts for a misplaced formulation", () => {
    const result = storageLocationFormSchema.safeParse({
      name: "North bin",
      type: "biochar_bin",
      facilityId: FACILITY_ID,
      formulationId: RELATED_ID,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe(
      "A formulation can only be assigned to a product bin",
    );
  });

  it("uses visible concepts for a misplaced feedstock type", () => {
    const result = storageLocationQuickAddSchema.safeParse({
      name: "Packed product",
      type: "product_bin",
      facilityId: FACILITY_ID,
      feedstockTypeId: RELATED_ID,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe(
      "A feedstock type can only be assigned to a feedstock bin",
    );
  });
});
