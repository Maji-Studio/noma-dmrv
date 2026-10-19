/**
 * The server keeps refusing an ordinary edit of a posted product's facts.
 * The product form disables those fields before typing (#1119), so the E2E
 * no longer reaches this refusal; this test keeps it covered.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { biocharProducts } from "@/db/schema";
import { updateBiocharProduct } from "@/data-access/biochar-product-update";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

describe("posted product facts", () => {
  it("refuses a moisture change but accepts density, a free field", async () => {
    await withLineageFixture(async (fixture) => {
      const read = async () => (await db.select().from(biocharProducts)
        .where(and(eq(biocharProducts.organizationId, TEST_ORG_ID), eq(biocharProducts.id, fixture.productId))))[0];
      const product = await read();
      await expect(updateBiocharProduct(makeTestOrgContext(), fixture.productId, {
        expectedVersion: product.version, moistureContentPercent: (product.moistureContentPercent ?? 0) + 1,
      })).rejects.toThrow("Posted product source, composition, placement, and bin are immutable");

      const saved = await updateBiocharProduct(makeTestOrgContext(), fixture.productId, { expectedVersion: product.version, densityKgM3: 350 });
      expect(saved.densityKgM3).toBe(350);
    }, "none");
  });
});
