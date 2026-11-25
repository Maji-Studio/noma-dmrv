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
  it("lets all bin types hold a mixed pile", () => {
    expect(storageLocationFormSchema.safeParse({ ...base, type: "biochar_bin", stockMode: "mix" }).success).toBe(true);
    expect(storageLocationFormSchema.safeParse({ ...base, type: "product_bin", stockMode: "mix" }).success).toBe(true);
    const feedstock = storageLocationFormSchema.safeParse({ ...base, type: "feedstock_bin", feedstockTypeId: FACILITY_ID, stockMode: "mix" });
    expect(feedstock.success).toBe(true);
    expect(feedstock.data?.stockMode).toBe("mix");
  });

  it("does not flag an update that leaves the type out", () => {
    expect(updateStorageLocationSchema.safeParse({ expectedVersion: 1, storageLocationId: FACILITY_ID, stockMode: "mix" }).success).toBe(true);
    expect(updateStorageLocationSchema.safeParse({ expectedVersion: 1, storageLocationId: FACILITY_ID, type: "feedstock_bin", stockMode: "mix" }).success).toBe(true);
  });
});

describe("default draw order", () => {
  const create = { name: "North bay", facilityId: FACILITY_ID, type: "biochar_bin", stockMode: "split" };
  const update = { storageLocationId: RELATED_ID, expectedVersion: 1 };
  it.each(["oldest_first", "newest_first"])("carries %s through create and update", (drawOrder) => {
    expect(storageLocationFormSchema.parse({ ...create, drawOrder }).drawOrder).toBe(drawOrder);
    expect(updateStorageLocationSchema.parse({ ...update, drawOrder }).drawOrder).toBe(drawOrder);
  });
  it("allows omission for seeds and partial updates but rejects null and unknown orders", () => {
    expect(storageLocationFormSchema.parse(create).drawOrder).toBeUndefined();
    expect(updateStorageLocationSchema.parse(update).drawOrder).toBeUndefined();
    for (const drawOrder of [null, "random"]) {
      expect(storageLocationFormSchema.safeParse({ ...create, drawOrder }).success).toBe(false);
      expect(updateStorageLocationSchema.safeParse({ ...update, drawOrder }).success).toBe(false);
    }
  });
});


describe("uncarbonized feedstock segregation", () => {
  const create = { name: "Failed material", facilityId: FACILITY_ID, feedstockTypeId: RELATED_ID, uncarbonized: true };
  const update = { storageLocationId: RELATED_ID, expectedVersion: 1, uncarbonized: true };
  it("accepts the tag on a feedstock bin and on partial updates", () => {
    expect(storageLocationFormSchema.parse({ ...create, type: "feedstock_bin" }).uncarbonized).toBe(true);
    expect(storageLocationQuickAddSchema.parse({ ...create, type: "feedstock_bin" }).uncarbonized).toBe(true);
    expect(updateStorageLocationSchema.parse(update).uncarbonized).toBe(true);
  });
  it.each(["biochar_bin", "product_bin"])("rejects the tag on %s with its field path", type => {
    for (const result of [
      storageLocationFormSchema.safeParse({ ...create, type }),
      storageLocationQuickAddSchema.safeParse({ ...create, feedstockTypeId: undefined, type }),
      updateStorageLocationSchema.safeParse({ ...update, type }),
    ]) {
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["uncarbonized"] }));
    }
  });
  it("requires a feedstock type even on a tagged bin", () => {
    for (const schema of [storageLocationFormSchema, storageLocationQuickAddSchema]) {
      const result = schema.safeParse({ ...create, type: "feedstock_bin", feedstockTypeId: null });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["feedstockTypeId"] }));
    }
  });
  it("keeps omission distinct from false and rejects non-boolean tags", () => {
    expect(updateStorageLocationSchema.parse({ ...update, uncarbonized: false }).uncarbonized).toBe(false);
    expect(updateStorageLocationSchema.parse({ ...update, uncarbonized: undefined }).uncarbonized).toBeUndefined();
    for (const uncarbonized of ["true", "false", null, 1]) {
      expect(updateStorageLocationSchema.safeParse({ ...update, uncarbonized }).success).toBe(false);
    }
  });
});
