/**
 * An emissions entry recorded after its batch's Removal was sent (#1059 part 1),
 * on screen: the entry row on the Emissions page and the credit batch Overview
 * with its list and Blocking to-do, with a later draft Removal that takes the
 * entry and with none.
 *
 * LATE_ENTRY_SHOTS=before|after saves screenshots under
 * artifacts/late-entry-carry-screen/<phase>/ (not committed). Run with
 * NEXT_PUBLIC_SHOT_MODE=true so the sidebar hides the signed-in email.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { seedLateEntry } from "./fixtures/late-entry-seed";
import { waitForFacilityHydration } from "./fixtures/page-helpers";

const PHASE = process.env.LATE_ENTRY_SHOTS;
const SHOT_DIR = path.join(process.cwd(), "artifacts", "late-entry-carry-screen", PHASE ?? "after");
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } } as const;
type Size = keyof typeof WIDTHS;

async function shoot(page: Page, name: string, size: Size, target?: Locator) {
  if (!PHASE) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(400);
  const file = path.join(SHOT_DIR, `${name}-${WIDTHS[size].width}.png`);
  if (target) {
    // An element shot scrolls it into view: the phone's pinned top bar would sit across it.
    await page.evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>("body *")) {
        const box = element.getBoundingClientRect();
        const { position } = getComputedStyle(element);
        if ((position === "fixed" || position === "sticky") && box.height < 80 && box.width > 300) element.style.visibility = "hidden";
      }
    });
    await target.screenshot({ path: file });
  } else await page.screenshot({ path: file });
}

async function openElectricity(page: Page) {
  const line = page.getByRole("button", { name: /Electricity use/ }).locator("visible=true").first();
  await expect(line).toBeVisible({ timeout: 30_000 });
  await line.click();
}

test.describe("Late emissions entry on screen", () => {
  test("shows where the entry goes, then that it waits", async ({ adminPage: page, seededData }) => {
    test.setTimeout(300_000);
    const facilityId = seededData.facility.id;
    const tag = crypto.randomUUID().slice(0, 6).toUpperCase();
    const seeded = await seedLateEntry(seededData, tag);
    const emissionsUrl = `/emissions/${seeded.origin.creditBatchId}?facility=${facilityId}`;
    const batchUrl = `/credit-batches/${seeded.origin.creditBatchId}?facility=${facilityId}`;
    try {
      for (const size of Object.keys(WIDTHS) as Size[]) {
        await page.setViewportSize(WIDTHS[size]);

        await page.goto(emissionsUrl);
        if (size === "desktop") await waitForFacilityHydration(page, seededData.facility.name);
        await openElectricity(page);
        const note = page.locator("[data-late-entry]").locator("visible=true").first();
        await expect(note).toContainText(`Recorded after ${seeded.origin.removalCode} was sent.`, { timeout: 30_000 });
        await expect(note).toContainText(`Goes into ${seeded.receiver.removalCode} (credit batch ${seeded.receiver.creditBatchCode}).`);
        await shoot(page, "entry-row-draft", size, page.getByRole("table", { name: /Sources of Electricity use/ }));

        await page.goto(batchUrl);
        const list = page.locator("[data-late-entries]");
        await expect(list).toContainText(`Goes into ${seeded.receiver.removalCode}`, { timeout: 30_000 });
        await expect(page.getByText("is waiting for a Removal")).toHaveCount(0);
        await shoot(page, "batch-overview-draft", size, page.getByRole("region", { name: "Removals" }));
        await expect(list.getByRole("link", { name: seeded.origin.removalCode }).first()).toBeVisible();
        await expect(list.getByRole("link", { name: seeded.receiver.creditBatchCode }).first()).toBeVisible();
      }

      await seeded.dropReceiver();
      for (const size of Object.keys(WIDTHS) as Size[]) {
        await page.setViewportSize(WIDTHS[size]);

        await page.goto(emissionsUrl);
        await openElectricity(page);
        const note = page.locator("[data-late-entry]").locator("visible=true").first();
        await expect(note).toContainText("Waiting for a Removal. No later draft is available at this facility.", { timeout: 30_000 });
        await expect(page.getByRole("link", { name: "New Removal" }).locator("visible=true").first()).toBeVisible();
        await shoot(page, "entry-row-waiting", size, page.getByRole("table", { name: /Sources of Electricity use/ }));

        await page.goto(batchUrl);
        await expect(page.getByText("Electricity use of Sep 14, 2026 is waiting for a Removal")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("[data-late-entries]")).toContainText("Waiting for a Removal.");
        await shoot(page, "batch-overview-waiting", size, page.getByRole("region", { name: "Removals" }));
        await shoot(page, "batch-todo-waiting", size, page.getByRole("button", { name: /Electricity use of Sep 14, 2026 is waiting/ }).or(page.getByRole("link", { name: /Electricity use of Sep 14, 2026 is waiting/ })).first());
      }
    } finally {
      await seeded.cleanup();
    }
  });
});
