import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  getBiocharProductEntityById,
  getBiocharProducts,
} from "@/data-access/entities/biochar-products";
import { db } from "@/db";
import { facilities, storageLocations } from "@/db/schema/facilities";
import { biocharProducts } from "@/db/schema/products";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

describe("order product-bin options", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const ctx = makeTestOrgContext();
  let facilityId: string;
  let productBinId: string;
  let productId: string;

  beforeAll(async () => {
    await ensureTestOrg();

    const fixture = await db.transaction(async (tx) => {
      const [facility] = await tx
        .insert(facilities)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FAC-OPB-${tag}`,
          name: `Order Product Bin Facility ${tag}`,
        })
        .returning({ id: facilities.id });
      const [productBin] = await tx
        .insert(storageLocations)
        .values({
          organizationId: TEST_ORG_ID,
          code: `BIN-OPB-${tag}`,
          name: `Order Product Bin ${tag}`,
          type: "product_bin",
          facilityId: facility.id,
        })
        .returning({ id: storageLocations.id });
      const [product] = await tx
        .insert(biocharProducts)
        .values({
          organizationId: TEST_ORG_ID,
          code: `BP-OPB-${tag}`,
          facilityId: facility.id,
          storageLocationId: productBin.id,
          massKg: 250,
          moistureContentPercent: 15,
        })
        .returning({ id: biocharProducts.id });

      return {
        facilityId: facility.id,
        productBinId: productBin.id,
        productId: product.id,
      };
    });

    facilityId = fixture.facilityId;
    productBinId = fixture.productBinId;
    productId = fixture.productId;
  });

  afterAll(async () => {
    await db.delete(biocharProducts).where(eq(biocharProducts.id, productId));
    await db
      .delete(storageLocations)
      .where(eq(storageLocations.id, productBinId));
    await db.delete(facilities).where(eq(facilities.id, facilityId));
  });

  it("shows the bin identity while retaining the product batch as the selected id", async () => {
    const options = await getBiocharProducts(ctx, {
      facilityId,
      limit: 10,
    });

    expect(options).toContainEqual({
      id: productId,
      code: `BIN-OPB-${tag}`,
      name: `Order Product Bin ${tag} • Pure biochar`,
      mass: {
        moisturePercent: 15,
      },
      remainingMass: {
        wetKg: 250,
        dryKg: 212.5,
      },
      subtitle:
        "Wet biochar product: 250kg | Dry biochar: 212.5kg available",
    });
  });

  it("keeps an existing selection resolvable after its bin is archived", async () => {
    await db
      .update(storageLocations)
      .set({ archivedAt: new Date() })
      .where(eq(storageLocations.id, productBinId));

    await expect(getBiocharProductEntityById(ctx, productId)).resolves.toEqual({
      id: productId,
      code: `BIN-OPB-${tag}`,
      name: `Order Product Bin ${tag} • Pure biochar`,
      mass: {
        moisturePercent: 15,
      },
      remainingMass: {
        wetKg: 250,
        dryKg: 212.5,
      },
      subtitle:
        "Wet biochar product: 250kg | Dry biochar: 212.5kg available",
    });
  });
});
