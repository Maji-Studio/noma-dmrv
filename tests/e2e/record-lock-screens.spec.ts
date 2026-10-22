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

  test("an application that becomes held while its sheet is open goes back to the saved value", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const removal = await seedGroupedRemovalWithChain(chainSeedRefs(seededData), tag);
    const { db, pool } = createDbConnection();
    try {
      const [application] = await db.select({ id: schema.applications.id }).from(schema.applications)
        .where(and(eq(schema.applications.organizationId, DEC_ORG_ID), eq(schema.applications.code, `E2E-APP-${tag}`)));
      const slice = and(
        eq(schema.creditBatchApplications.organizationId, DEC_ORG_ID),
        eq(schema.creditBatchApplications.applicationId, application.id),
      );
      // Free while the sheet opens; the Removal takes the application afterwards.
      await db.update(schema.creditBatchApplications).set({ removalId: null }).where(slice);

      await page.goto(`/applications?facility=${seededData.facility.id}&application=${application.id}`);
      await waitForFacilityHydration(page, seededData.facility.name);
      await waitForSideSheet(page);
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Edit application" }).click();
      const applied = sheet.locator('input[name="biocharAppliedKg"]');
      await expect(applied).toBeEnabled();
      await expect(applied).toHaveValue("100");

      await db.update(schema.creditBatchApplications).set({ removalId: removal.removalId }).where(slice);
      await applied.fill("90");
      await sheet.getByRole("button", { name: "Update application", exact: true }).click();

      await expect(applied).toBeDisabled();
      await expect(applied).toHaveValue("100");
      await expect(sheet.getByText("Locked. Your change was not saved.")).toBeVisible();
      // The summary box takes focus, so the reason is read from it.
      await expect(sheet.getByRole("group", { name: "Not saved. 1 field is locked." })).toBeFocused();
    } finally {
      await pool.end();
      await removal.cleanup();
    }
  });

  test("a record that becomes Sent while its sheet is open turns read-only with the refusal on top", async ({
    adminPage: page,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const removal = await seedGroupedRemovalWithChain(chainSeedRefs(seededData), tag);
    const submissionId = crypto.randomUUID();
    const { db, pool } = createDbConnection();
    try {
      await page.goto(`/feedstocks?facility=${seededData.facility.id}&feedstock=${seededData.feedstock.id}`);
      await waitForFacilityHydration(page, seededData.facility.name);
      await waitForSideSheet(page);
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Edit feedstock" }).click();
      const wetMass = sheet.locator('input[name="totalWetMassKg"]');
      await expect(wetMass).toBeEnabled();

      await db.insert(schema.certificationSubmissions).values({
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
        payloadHash: `e2e-record-lock-sent-${tag}`,
        submittedAt: new Date(),
      });
      const original = await wetMass.inputValue();
      await wetMass.fill(String(Number(original) + 10));
      await sheet.getByRole("button", { name: "Save changes", exact: true }).click();

      const refusal = sheet.locator("[data-top-refusal]");
      await expect(refusal).toBeVisible();
      await expect(refusal).toBeFocused();
      await expect(refusal).toHaveAttribute("role", "group");
      await expect(refusal).toContainText("Your changes were not saved.")
      await expect(refusal).not.toContainText("The fields show what is saved");
      await expect(sheet.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
      // The header arrow and the footer both go back to the view.
      await expect(sheet.getByRole("button", { name: "Back to view" })).toHaveCount(2);
      await expect(wetMass).toBeDisabled();
      // Typed values go back to the saved ones, and nothing still shows the typed value.
      const typed = String(Number(original) + 10);
      await expect(wetMass).toHaveValue(original);
      await expect(sheet.getByText(new RegExp(`Load: ${typed}\\s*kg`))).toHaveCount(0);
      await expect(sheet.getByText(new RegExp(`Load: ${original}\\s*kg`)).first()).toBeVisible();
      // Above the lock line, not at the end of the form.
      const lockLine = sheet.getByText(/Nothing can be changed, because this was sent to Isometric/);
      await expect(lockLine).toBeVisible();
      const refusalBox = await refusal.boundingBox();
      const lockBox = await lockLine.boundingBox();
      expect(refusalBox!.y).toBeLessThan(lockBox!.y);
    } finally {
      await db.delete(schema.certificationSubmissions).where(and(eq(schema.certificationSubmissions.organizationId, DEC_ORG_ID), eq(schema.certificationSubmissions.id, submissionId)));
      await pool.end();
      await removal.cleanup();
    }
  });
});
