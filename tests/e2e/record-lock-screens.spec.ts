/**
 * Record locks on screen before typing (#1119).
 *
 * - An order with a delivery is In use: its sheet shows the chip, and its edit
 *   form disables the customer, location and formulation before anyone types,
 *   naming the delivery as a link.
 * - A Sample behind a Sent Removal offers neither Edit nor Delete and says
 *   which Removal holds it (#687 item 2).
 */
import * as crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { expect, test } from "./fixtures";
import { chainSeedRefs, seedGroupedRemovalWithChain } from "./fixtures/certification-helpers";
import { createDbConnection } from "./fixtures/db";
import { waitForFacilityHydration, waitForSideSheet } from "./fixtures/page-helpers";

test.describe("Record locks on screen", () => {
  test("an order with a delivery shows In use and disables what the delivery holds", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const removal = await seedGroupedRemovalWithChain(chainSeedRefs(seededData), tag);
    const { db, pool } = createDbConnection();
    try {
      const [order] = await db.select({ id: schema.orders.id }).from(schema.orders)
        .where(and(eq(schema.orders.organizationId, DEC_ORG_ID), eq(schema.orders.code, `E2E-ORD-${tag}`)));
      await page.goto(`/orders?facility=${seededData.facility.id}&order=${order.id}`);
      await waitForFacilityHydration(page, seededData.facility.name);
      await waitForSideSheet(page);
      const sheet = page.getByRole("dialog");

      await expect(sheet.locator('[data-record-lock="inUse"]')).toHaveText("In use");
      await expect(sheet.getByText(`delivery E2E-DEL-${tag} uses its figures`)).toBeVisible();
      await expect(sheet.getByRole("link", { name: `Delivery E2E-DEL-${tag}`, exact: true })).toBeVisible();

      await sheet.getByRole("button", { name: "Edit order" }).click();
      await expect(sheet.getByRole("link", { name: `delivery E2E-DEL-${tag}`, exact: true })).toHaveAttribute("href", /\/deliveries\?/);
      await expect(sheet.getByRole("combobox", { name: /^Customer/ }).first()).toBeDisabled();
      await expect(sheet.getByRole("combobox", { name: /^Formulation/ })).toBeDisabled();
      await expect(sheet.getByRole("spinbutton", { name: /^Requested wet mass/ })).toBeEnabled();
    } finally {
      await pool.end();
      await removal.cleanup();
    }
  });

  test("a Sample behind a Sent Removal hides Edit and Delete and names the Removal", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const removal = await seedGroupedRemovalWithChain(chainSeedRefs(seededData), tag);
    const sampleId = crypto.randomUUID();
    const submissionId = crypto.randomUUID();
    const sampleCode = `E2E-SMP-LOCK-${tag}`;
    const { db, pool } = createDbConnection();
    try {
      await db.transaction(async (tx) => {
        await tx.update(schema.certifierRemovals)
          .set({ startedOn: "2026-01-01", completedOn: "2026-03-31" })
          .where(and(eq(schema.certifierRemovals.organizationId, DEC_ORG_ID), eq(schema.certifierRemovals.id, removal.removalId)));
        await tx.insert(schema.certificationSubmissions).values({
          organizationId: DEC_ORG_ID,
          id: submissionId,
          provider: "isometric",
          submissionType: "removal",
          localEntityType: "removal",
          localEntityId: removal.removalId,
          version: 1,
          status: "submitted",
          externalId: `e2e-removal-${tag}`,
          payloadSnapshot: {},
          payloadHash: `e2e-record-lock-${tag}`,
          submittedAt: new Date(),
        });
        await tx.insert(schema.samples).values({
          organizationId: DEC_ORG_ID,
          id: sampleId,
          sampleCode,
          creditBatchId: removal.creditBatch.id,
          samplingTime: new Date(),
          totalCarbonPercent: 80,
          organicCarbonPercent: 78,
        });
      });

      await page.goto(`/samples?facility=${seededData.facility.id}`);
      await waitForFacilityHydration(page, seededData.facility.name);
      const row = page.getByRole("row").filter({ hasText: sampleCode });
      await expect(row.getByRole("img", { name: "Sent" })).toBeVisible();
      await expect(row.getByRole("button", { name: `Actions for ${sampleCode}` })).toHaveCount(0);

      await row.click();
      await waitForSideSheet(page);
      const sheet = page.getByRole("dialog");
      await expect(sheet.locator('[data-record-lock="sent"]')).toHaveText("Sent");
      await expect(sheet.getByText("Nothing can be changed, because this was sent to Isometric with Removal Jan 1 to Mar 31, 2026.")).toBeVisible();
      await expect(sheet.getByRole("link", { name: "Removal Jan 1 to Mar 31, 2026" }).first())
        .toHaveAttribute("href", new RegExp(`removal=${removal.removalId}`));
      await expect(sheet.getByRole("button", { name: "Edit Sample" })).toHaveCount(0);
    } finally {
      await db.delete(schema.samples).where(and(eq(schema.samples.organizationId, DEC_ORG_ID), eq(schema.samples.id, sampleId)));
      await db.delete(schema.certificationSubmissions).where(and(eq(schema.certificationSubmissions.organizationId, DEC_ORG_ID), eq(schema.certificationSubmissions.id, submissionId)));
      await pool.end();
      await removal.cleanup();
    }
  });
});
