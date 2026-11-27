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

describe("uncarbonized bin tag", () => {
  const base = { name: "E2E Segregated bin", facilityId: FACILITY_ID };
  it.each([storageLocationFormSchema, storageLocationQuickAddSchema])("accepts either biochar tag and refuses other tagged lanes", schema => {
    for (const uncarbonized of [true, false]) {
      expect(schema.parse({ ...base, type: "biochar_bin", uncarbonized }).uncarbonized).toBe(uncarbonized);
    }
    for (const type of ["feedstock_bin", "product_bin"]) {
      const parsed = schema.safeParse({ ...base, type, feedstockTypeId: type === "feedstock_bin" ? RELATED_ID : undefined, uncarbonized: true });
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error("Tagged non-biochar bin was accepted");
      expect(parsed.error.issues).toContainEqual(expect.objectContaining({ path: ["uncarbonized"], message: "Only biochar bins can hold uncarbonized material." }));
    }
  });
  it("preserves partial update omission and explicit false", () => {
    const update = { storageLocationId: RELATED_ID, expectedVersion: 1 };
    expect(updateStorageLocationSchema.parse(update).uncarbonized).toBeUndefined();
    expect(updateStorageLocationSchema.parse({ ...update, uncarbonized: false }).uncarbonized).toBe(false);
    expect(updateStorageLocationSchema.parse({ ...update, uncarbonized: true }).uncarbonized).toBe(true);
    const result = updateStorageLocationSchema.safeParse({ ...update, type: "product_bin", uncarbonized: true });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Tagged product bin was accepted");
    expect(result.error.issues[0]?.path).toEqual(["uncarbonized"]);
  });
  it("rejects null and truthy strings instead of coercing them", () => {
    for (const uncarbonized of [null, "true", "false", 1]) {
      expect(storageLocationFormSchema.safeParse({ ...base, type: "biochar_bin", uncarbonized }).success).toBe(false);
    }
  });
});
