/**
 * PR 5 evidence: a returned Removal whose lineage (not an emissions entry)
 * changed after it was sent, and the credit batch it holds.
 *
 * The seed is the returned-Removal seed with nothing changed in the entries.
 * The sent snapshot records a different production run than the batch has now
 * (seed option sentSemantic), so the live lineage no longer matches what was sent. Run the same spec on
 * staging (before) and on the branch (after); same preload and env as
 * removal-correction-screen.spec.ts. LINEAGE_SHOTS=before|after saves to
 * artifacts/lineage-correction-screen/<phase>/ (not committed).
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { returnedRemovalSeedsEnabled, seedReturnedConnection, seedReturnedRemoval } from "./fixtures/returned-removal-seed";
import { creditBatchRow, waitForFacilityHydration, waitForSideSheet } from "./fixtures/page-helpers";

const PHASE = process.env.LINEAGE_SHOTS ?? "after";
const SHOT_DIR = path.join(process.cwd(), "artifacts", "lineage-correction-screen", PHASE);
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } } as const;

async function shoot(page: Page, name: string, width: keyof typeof WIDTHS, target?: Locator) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(500);
  const file = path.join(SHOT_DIR, `${name}-${WIDTHS[width].width}.png`);
  if (target) await target.screenshot({ path: file });
  else await page.screenshot({ path: file });
}

test.describe("Lineage-only correction screens", () => {
  test.skip(!returnedRemovalSeedsEnabled(), "Needs CREDENTIALS_ENCRYPTION_KEY and the registry stub preload.");

  test("a returned Removal with changed lineage and the batch it holds", async ({ adminPage: page, seededData }) => {
    test.setTimeout(300_000);
    const facilityId = seededData.facility.id;
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const cleanupConnection = await seedReturnedConnection(facilityId);
    const cleanups: Array<() => Promise<void>> = [];
    try {
      const removal = await seedReturnedRemoval(seededData, `${tag}L`, {
        changed: false, statementStatus: "FAILED_VERIFICATION", periodStartOn: "2026-07-01", periodEndOn: "2026-09-30",
        // Sent from a production run that is not the batch's run now: only a lineage record differs.
        sentSemantic: { startedOn: "2026-07-01", completedOn: "2026-09-30", sourceProductionRunIds: [crypto.randomUUID()] } });
      cleanups.push(removal.cleanup);

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
        await shoot(page, "removal-notice", size);

        await page.goto(`/credit-batches?facility=${facilityId}&view=list`);
        const batchRow = creditBatchRow(page, removal.creditBatch.code).locator("visible=true").first();
        await expect(batchRow).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(3000);
        await batchRow.getByRole("button", { name: `Actions for credit batch ${removal.creditBatch.code}` }).click();
        await expect(page.getByRole("menuitem", { name: "Open details" })).toBeVisible();
        const labels = await page.getByRole("menuitem").allInnerTexts();
        console.log(`MENU[${PHASE}/${size}]: ${labels.join(", ")}`);
        await shoot(page, "batch-menu", size);
        await page.keyboard.press("Escape");
      }
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup();
      await cleanupConnection();
    }
  });
});
