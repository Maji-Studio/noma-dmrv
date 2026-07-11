import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { test, expect } from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";
import { seedCreditBatch } from "./fixtures/seed-chain-data";
import * as schema from "../../src/db/schema";

test.describe("credit batch facility scope", () => {
  test("detail URLs redirect to the batch facility when the query points elsewhere", async ({
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

      await adminPage.goto(
        `/credit-batches/${batch.id}?facility=${otherFacilityId}`,
      );

      await expect(adminPage).toHaveURL(
        new RegExp(
          `/credit-batches/${batch.id}\\?facility=${seededData.facility.id}`,
        ),
      );
      await expect(
        adminPage.getByRole("heading", { name: batch.code }),
      ).toBeVisible();
      await expect(
        adminPage.getByRole("button", { name: seededData.facility.name }),
      ).toBeVisible();
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
