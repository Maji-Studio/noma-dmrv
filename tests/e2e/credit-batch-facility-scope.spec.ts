import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { test, expect } from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";
import { seedCreditBatch } from "./fixtures/seed-chain-data";
import * as schema from "../../src/db/schema";

test.describe("credit batch facility scope", () => {
  test("deep links to a batch outside the selected facility are refused", async ({
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
        organizationId: DEC_ORG_ID,
          code: `FAC-CB-SCOPE-${tag}`,
          name: `Credit Batch Scope Facility ${tag}`,
          country: "Tanzania",
          timezone: "Africa/Dar_es_Salaam",
        })
        .returning({ id: schema.facilities.id });
      otherFacilityId = otherFacility.id;

      // The retired detail route redirects into the list's view sheet. With
      // the query pointing at another facility, the deep link must be cleared
      // with a toast instead of silently switching facilities or opening the
      // batch across the facility boundary.
      await adminPage.goto(
        `/credit-batches/${batch.id}?facility=${otherFacilityId}`,
      );

      await expect(
        adminPage.getByText(
          "Linked credit batch is not in the selected facility",
        ),
      ).toBeVisible({ timeout: 15000 });
      await expect(adminPage).not.toHaveURL(
        new RegExp(`batch=${batch.id}`),
      );
      await expect(
        adminPage.getByRole("heading", { name: batch.code }),
      ).toHaveCount(0);
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
