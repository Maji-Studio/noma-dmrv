/**
 * A returned Removal on screen (variant A "Status and notice").
 *
 * Seeds two sent Removals whose GHG Statement Isometric returned, one with
 * nothing changed since it was sent and one whose sent components changed,
 * then checks the Removals list, the Removal sheet and the credit batch open
 * items, and saves screenshots at 1440 and 390 px. A Removal reads as returned
 * only while the app server can read its GHG Statement from the registry, so the
 * dev server runs with `helpers/returned-removal-registry-stub.cjs` preloaded
 * (its header gives the command) and this spec runs with RETURNED_STATEMENT_STUB=1.
 * Without both it skips.
 *
 * CORRECTION_SHOTS=before|after saves the screenshots under
 * artifacts/correction-screen/<phase>/ (not committed).
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { returnedRemovalSeedsEnabled, seedReturnedConnection, seedReturnedRemoval } from "./fixtures/returned-removal-seed";
import { waitForFacilityHydration, waitForSideSheet } from "./fixtures/page-helpers";

const PHASE = process.env.CORRECTION_SHOTS;
const SHOT_DIR = path.join(process.cwd(), "artifacts", "correction-screen", PHASE ?? "after");
/** Before the UI change the screens still carry the lock-based "Correction needed", so only the shots are taken. */
const CHECK_COPY = PHASE !== "before";
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } } as const;

async function shoot(page: Page, name: string, width: keyof typeof WIDTHS, target?: Locator) {
  if (!PHASE) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  // The dev server's Next.js indicator would sit in every shot.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(400);
  const file = path.join(SHOT_DIR, `${name}-${WIDTHS[width].width}.png`);
  if (target) {
    // An element shot scrolls it into view: the phone's pinned top bar would sit across it.
    await page.evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>("body *")) {
        const box = element.getBoundingClientRect();
        const { position } = getComputedStyle(element);
        if ((position === "fixed" || position === "sticky") && box.top <= 0 && box.height < 80 && box.width > 300) element.style.visibility = "hidden";
      }
    });
    await target.screenshot({ path: file });
  }
  else await page.screenshot({ path: file });
}

test.describe("Returned Removal screens", () => {
  test.skip(!returnedRemovalSeedsEnabled(), "Needs CREDENTIALS_ENCRYPTION_KEY and the preload that answers the returned statement read.");

  test("a returned Removal shows its status, notice and open item", async ({ adminPage: page, seededData }) => {
    test.setTimeout(300_000);
    const facilityId = seededData.facility.id;
    const facilityName = seededData.facility.name;
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const cleanupConnection = await seedReturnedConnection(facilityId);
    const cleanups: Array<() => Promise<void>> = [];
    try {
      const changed = await seedReturnedRemoval(seededData, `${tag}C`, {
        changed: true, statementStatus: "FAILED_VERIFICATION", periodStartOn: "2026-07-01", periodEndOn: "2026-09-30" });
      cleanups.push(changed.cleanup);
      const open = await seedReturnedRemoval(seededData, `${tag}O`, {
        changed: false, statementStatus: "DRAFT", periodStartOn: "2026-04-01", periodEndOn: "2026-06-30" });
      cleanups.push(open.cleanup);

      for (const [size, viewport] of Object.entries(WIDTHS) as [keyof typeof WIDTHS, (typeof WIDTHS)[keyof typeof WIDTHS]][]) {
        await page.setViewportSize(viewport);
        await page.goto(`/certification/removals?facility=${facilityId}`);
        if (size === "desktop") await waitForFacilityHydration(page, facilityName);
        // Both layouts are in the DOM; read the visible one. Desktop scopes to the row.
        const seen = (text: string, code?: string) => (size === "desktop" && code ? page.getByRole("row").filter({ hasText: code }) : page)
          .getByText(text, { exact: true }).locator("visible=true").first();
        await expect(seen(changed.removalCode)).toBeVisible();
        await expect(seen(open.removalCode)).toBeVisible();
        if (CHECK_COPY) {
          await expect(seen("Resubmit needed", changed.removalCode)).toBeVisible({ timeout: 30_000 });
          await expect(seen("Returned", open.removalCode)).toBeVisible();
          await expect(page.getByText("Correction needed")).toHaveCount(0);
        } else {
          await expect(seen("Correction needed", changed.removalCode)).toBeVisible({ timeout: 30_000 });
          await expect(seen("Correction needed", open.removalCode)).toBeVisible();
        }
        await shoot(page, "removals-list", size);

        await page.goto(`/certification/removals?facility=${facilityId}&removal=${changed.removalId}`);
        await waitForSideSheet(page);
        const sheet = page.getByRole("dialog");
        if (CHECK_COPY) {
          await expect(sheet).toContainText("Diesel use");
          await expect(sheet).toContainText("changed since this Removal was sent. Resubmit it, then resubmit");
          await expect(sheet.getByRole("link", { name: "Resubmit Removal" })).toHaveAttribute("href", new RegExp(`resume=${changed.removalId}`));
          await expect(sheet).not.toContainText("Correction needed");
        } else {
          await expect(sheet).toContainText("Correction needed", { timeout: 30_000 });
        }
        await shoot(page, "removal-sheet-changed", size);

        await page.goto(`/certification/removals?facility=${facilityId}&removal=${open.removalId}`);
        await waitForSideSheet(page);
        const openSheet = page.getByRole("dialog");
        if (CHECK_COPY) {
          await expect(openSheet).toContainText("Returned by Isometric");
          await expect(openSheet).toContainText("is back in draft. Correct the sent entries on");
          await expect(openSheet.getByRole("link", { name: "Open GHG Statement" })).toBeVisible();
          await expect(openSheet.getByRole("link", { name: "Resubmit Removal" })).toHaveCount(0);
        } else {
          await expect(openSheet).toContainText("Correction needed", { timeout: 30_000 });
        }
        await shoot(page, "removal-sheet-returned", size);

        await page.goto(`/credit-batches/${changed.creditBatch.id}?facility=${facilityId}`);
        if (CHECK_COPY) {
          await expect(page.getByText(`${changed.removalCode}: Resubmit needed`)).toBeVisible({ timeout: 30_000 });
          await expect(page.getByText(`Diesel use and Transport to field changed here since ${changed.removalCode} was sent. Resubmit the Removal to send it.`)).toBeVisible();
        } else {
          await expect(page.getByText(changed.creditBatch.code).first()).toBeVisible({ timeout: 30_000 });
        }
        await shoot(page, "batch-open-items-changed", size, page.getByRole("region", { name: "Open to-dos" }));

        await page.goto(`/credit-batches/${open.creditBatch.id}?facility=${facilityId}`);
        if (CHECK_COPY) {
          await expect(page.getByText(`${open.removalCode}: Returned by Isometric`)).toBeVisible({ timeout: 30_000 });
          await expect(page.getByText("is back in draft. You can correct the sent entries on the Emissions tab.")).toBeVisible();
        } else {
          await expect(page.getByText(open.creditBatch.code).first()).toBeVisible({ timeout: 30_000 });
        }
        await shoot(page, "batch-open-items-returned", size, page.getByRole("region", { name: "Open to-dos" }));

        // The re-entered Diesel use entry waits for the Removal to be resubmitted.
        await page.goto(`/emissions/${changed.creditBatch.id}?facility=${facilityId}`);
        const dieselLine = page.getByRole("button", { name: /Diesel use/ }).locator("visible=true").first();
        await expect(dieselLine).toBeVisible({ timeout: 30_000 });
        await dieselLine.click({ timeout: 10_000 });
        if (CHECK_COPY) {
          await expect(page.getByText("Waiting for resubmit", { exact: true }).locator("visible=true").first()).toBeVisible();
        } else {
          await expect(page.getByText("12 kWh").locator("visible=true").first()).toBeVisible();
        }
        await shoot(page, "batch-emissions-entry", size);
      }

      // Resubmit Removal reopens the New Removal wizard on the Removal (its href is asserted on the sheet above).
      for (const [size, viewport] of Object.entries(WIDTHS) as [keyof typeof WIDTHS, (typeof WIDTHS)[keyof typeof WIDTHS]][]) {
        await page.setViewportSize(viewport);
        await page.goto(`/certification/removals?facility=${facilityId}&resume=${changed.removalId}`);
        await expect(page.getByRole("dialog").getByRole("heading", { name: "New Removal" })).toBeVisible();
        await expect(page.getByRole("dialog").getByRole("heading", { name: "Empty components" })).toBeVisible({ timeout: 30_000 });
        await shoot(page, "resubmit-wizard", size);
      }

      if (CHECK_COPY) {
        // On a phone the rail shows one step, so the submit step keeps a way back to Empty components.
        await page.setViewportSize(WIDTHS.phone);
        await page.goto(`/certification/removals?facility=${facilityId}&resume=${changed.removalId}`);
        await page.getByRole("button", { name: /Record 2 components as zero/i }).click();
        await page.getByRole("button", { name: "Continue" }).click();
        const back = page.getByRole("button", { name: "Back to Empty components" });
        await expect(back).toBeVisible({ timeout: 30_000 });
        expect((await back.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        await shoot(page, "new-removal-submit-back", "phone");
      }

      await page.setViewportSize(WIDTHS.phone);
      await page.goto(`/certification/removals?facility=${facilityId}&create=true`);
      await expect(page.getByRole("dialog").getByText("New Removal")).toBeVisible();
      await expect(page.getByText("Loading credit batches")).toHaveCount(0, { timeout: 30_000 });
      await shoot(page, "new-removal-rail", "phone");
      await page.setViewportSize(WIDTHS.desktop);
      await shoot(page, "new-removal-rail", "desktop");
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup();
      await cleanupConnection();
    }
  });
});
