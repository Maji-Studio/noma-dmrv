import { TEST_SITE_POSITION } from "../helpers/test-org";
import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { test, expect } from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";
import { seedCreditBatch } from "./fixtures/seed-chain-data";
import * as schema from "../../src/db/schema";

test.describe("credit batch facility scope", () => {
  test("the page follows the batch's own facility", async ({
    adminPage,
    seededData,
  }) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const batch = await seedCreditBatch(
      seededData.facility.id,
      `SCOPE-${tag}`,
      seededData.feedstockType.id,
    );
    const { db, pool } = createDbConnection();
    let otherFacilityId: string | undefined;

    try {
      const [otherFacility] = await db
        .insert(schema.facilities)
        .values({
          ...TEST_SITE_POSITION,
          organizationId: DEC_ORG_ID,
          code: `FAC-CB-SCOPE-${tag}`,
          name: `Credit Batch Scope Facility ${tag}`,
          timezone: "Africa/Dar_es_Salaam",
        })
        .returning({ id: schema.facilities.id });
      otherFacilityId = otherFacility.id;

      // The page takes its facility from the batch: a link without one gains
      // it, and a link naming another facility is a not-found.
      await adminPage.goto(`/credit-batches/${batch.id}`);
      await expect(adminPage).toHaveURL((url) => {
        return (
          url.pathname === `/credit-batches/${batch.id}` &&
          url.searchParams.get("facility") === seededData.facility.id
        );
      });
      await expect(
        adminPage.getByRole("heading", { level: 1, name: batch.code }),
      ).toBeVisible();

      const response = await adminPage.goto(
        `/credit-batches/${batch.id}?facility=${otherFacilityId}`,
      );
      expect(response?.status()).toBe(404);
      await expect(
        adminPage.getByRole("heading", { name: "Credit batch not found", exact: true }),
      ).toBeVisible();
      await expect(adminPage.getByText(batch.code, { exact: true })).toHaveCount(0);
    } finally {
      if (otherFacilityId) {
        await db
          .delete(schema.facilities)
          .where(eq(schema.facilities.id, otherFacilityId));
      }
      await pool.end();
    }
  });
});
