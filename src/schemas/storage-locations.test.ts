import { describe, expect, it } from "vitest";
import { storageLocationQuickAddSchema } from "./quick-add";
import {
  formatStorageLocationType,
  storageLocationFormSchema,
  updateStorageLocationSchema,
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

describe("updateStorageLocationSchema", () => {
  it("drops a facility, because a bin never changes facility through the update action", () => {
    const parsed = updateStorageLocationSchema.parse({ expectedVersion: 1,
      storageLocationId: RELATED_ID,
      facilityId: FACILITY_ID,
    });
    expect(parsed).not.toHaveProperty("facilityId");
  });
});

describe("stock mode", () => {
  const base = { name: "Pile", facilityId: FACILITY_ID };
  it("lets only biochar and product bins hold one mixed pile", () => {
    expect(storageLocationFormSchema.safeParse({ ...base, type: "biochar_bin", stockMode: "mix" }).success).toBe(true);
    expect(storageLocationFormSchema.safeParse({ ...base, type: "product_bin", stockMode: "mix" }).success).toBe(true);
    const feedstock = storageLocationFormSchema.safeParse({ ...base, type: "feedstock_bin", feedstockTypeId: FACILITY_ID, stockMode: "mix" });
    expect(feedstock.success).toBe(false);
    expect(feedstock.error?.issues.map(issue => issue.path.join("."))).toContain("stockMode");
  });

  it("does not flag an update that leaves the type out", () => {
    expect(updateStorageLocationSchema.safeParse({ expectedVersion: 1, storageLocationId: FACILITY_ID, stockMode: "mix" }).success).toBe(true);
    expect(updateStorageLocationSchema.safeParse({ expectedVersion: 1, storageLocationId: FACILITY_ID, type: "feedstock_bin", stockMode: "mix" }).success).toBe(false);
  });
});
