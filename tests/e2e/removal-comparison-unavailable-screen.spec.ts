/**
 * Evidence for "noma could not compare this Removal with what it sent": a returned
 * Removal whose credit batch holds an emissions value with no file, so noma cannot
 * compile the Removal to compare it. Shoots the Removal sheet notice and the credit
 * batch open items at 1440 and 390 px. Same preload and env as
 * removal-correction-screen.spec.ts. COMPARE_SHOTS=before|after saves to
 * artifacts/comparison-unavailable-screen/<phase>/ (not committed).
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Locator, Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { DEC_ORG_ID } from "@/db/org-defaults";
import * as schema from "../../src/db/schema";
import { createDbConnection } from "./fixtures/db";
import { expect, test } from "./fixtures";
import { RETURNED_TEMPLATE_ID, returnedRemovalSeedsEnabled, seedReturnedConnection, seedReturnedRemoval } from "./fixtures/returned-removal-seed";
import { creditBatchRow, waitForFacilityHydration, waitForSideSheet } from "./fixtures/page-helpers";

const PHASE = process.env.COMPARE_SHOTS ?? "after";
const SHOT_DIR = path.join(process.cwd(), "artifacts", "comparison-unavailable-screen", PHASE);
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } } as const;

/** A value entry on the batch with no file: the blocker that stops noma compiling the Removal. Removed by the seed's cleanup. */
async function addEntryWithoutFile(creditBatchId: string) {
  const { db, pool } = createDbConnection();
  try {
    const [observation] = await db.select().from(schema.removalTemplateObservations).where(and(
      eq(schema.removalTemplateObservations.organizationId, DEC_ORG_ID),
      eq(schema.removalTemplateObservations.externalTemplateId, RETURNED_TEMPLATE_ID)));
    const entryId = crypto.randomUUID();
    await db.insert(schema.emissionEntries).values({
      id: entryId, organizationId: DEC_ORG_ID, creditBatchId, removalTemplateId: RETURNED_TEMPLATE_ID,
      componentId: "e2e-diesel", inputShape: [{ key: "electricity_use", type: "monitored" as const, quantityKind: "energy" as const }],
      lineRule: "additive" as const, observationId: observation.id, kind: "value" as const, occurredOn: "2026-09-10",
    });
    await db.insert(schema.emissionEntryValues).values({ organizationId: DEC_ORG_ID, entryId, inputKey: "electricity_use", magnitude: "10", unit: "kWh" });
  } finally {
    await pool.end();
  }
}

async function shoot(page: Page, name: string, width: keyof typeof WIDTHS, target?: Locator) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(500);
  const file = path.join(SHOT_DIR, `${name}-${WIDTHS[width].width}.png`);
  if (target) await target.screenshot({ path: file });
  else await page.screenshot({ path: file });
}

test.describe("Comparison unavailable screens", () => {
  test.skip(!returnedRemovalSeedsEnabled(), "Needs CREDENTIALS_ENCRYPTION_KEY and the registry stub preload.");

  test("a returned Removal noma cannot compare and the batch it holds", async ({ adminPage: page, seededData, testUsers }) => {
    test.setTimeout(300_000);
    const facilityId = seededData.facility.id;
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const cleanupConnection = await seedReturnedConnection(facilityId);
    const cleanups: Array<() => Promise<void>> = [];
    try {
      const removal = await seedReturnedRemoval(seededData, `${tag}L`, {
        adminUserId: testUsers.admin.id,
        changed: false, statementStatus: "FAILED_VERIFICATION", periodStartOn: "2026-07-01", periodEndOn: "2026-09-30" });
      cleanups.push(removal.cleanup);
      await addEntryWithoutFile(removal.creditBatch.id);

      for (const [size, viewport] of Object.entries(WIDTHS) as [keyof typeof WIDTHS, (typeof WIDTHS)[keyof typeof WIDTHS]][]) {
        await page.setViewportSize(viewport);
        await page.goto(`/certification/removals?facility=${facilityId}`);
        if (size === "desktop") await waitForFacilityHydration(page, seededData.facility.name);
        const row = (size === "desktop" ? page.getByRole("row").filter({ hasText: removal.removalCode }) : page)
          .getByText(removal.removalCode, { exact: true }).locator("visible=true").first();
        await expect(row).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(3000);
        await shoot(page, "removals-list", size);

        await page.goto(`/certification/removals?facility=${facilityId}&removal=${removal.removalId}`);
        await waitForSideSheet(page);
        await expect(page.getByRole("dialog")).toContainText(removal.removalCode, { timeout: 30_000 });
        await page.waitForTimeout(3000);
        console.log(`SHEET[${PHASE}/${size}]: ${(await page.getByRole("dialog").innerText()).replace(/\n+/g, " | ").slice(0, 600)}`);
        const notice = page.locator('[data-removal-correction="resubmit"]').first();
        await expect(notice).toBeVisible();
        await expect(notice).toContainText("noma could not compare this Removal with what it sent.");
        await shoot(page, "removal-notice", size, notice);
        await shoot(page, "removal-sheet", size);

        await page.goto(`/credit-batches?facility=${facilityId}&view=list`);
        const batchRow = creditBatchRow(page, removal.creditBatch.code).locator("visible=true").first();
        await expect(batchRow).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(3000);
        await batchRow.getByRole("button", { name: `Actions for credit batch ${removal.creditBatch.code}` }).click();
        await expect(page.getByRole("menuitem", { name: "Open details" })).toBeVisible();
        await page.getByRole("menuitem", { name: "Open details" }).click();
        await expect(page.getByRole("heading", { name: removal.creditBatch.code })).toBeVisible({ timeout: 30_000 });
        const todo = page.getByText(`${removal.removalCode}: Resubmit needed`).first();
        await expect(todo).toBeVisible({ timeout: 30_000 });
        await todo.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1500);
        const item = todo.locator("xpath=ancestor::*[self::li or self::a or self::button or self::tr][1]");
        console.log(`TODO[${PHASE}/${size}]: ${(await item.innerText()).replace(/\n+/g, " | ")}`);
        await shoot(page, "batch-todo-item", size, item);
        await shoot(page, "batch-todo", size);
      }
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup();
      await cleanupConnection();
    }
  });
});
