/**
 * The Check to-do for a completed run that matched a credit batch but stayed
 * outside it because the batch's Removal was sent (#1059 part 2), on the batch
 * Overview's Open to-dos region.
 *
 * SHOTS=before|after saves screenshots under
 * artifacts/late-run-check-todo-screen/<phase>/ (not committed). Run with
 * NEXT_PUBLIC_SHOT_MODE=true so the sidebar hides the signed-in email.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { seedLateRun } from "./fixtures/late-run-seed";
import { waitForFacilityHydration } from "./fixtures/page-helpers";

const PHASE = process.env.SHOTS;
const SHOT_DIR = path.join(process.cwd(), "artifacts", "late-run-check-todo-screen", PHASE ?? "after");
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } } as const;
type Size = keyof typeof WIDTHS;

async function shoot(page: Page, name: string, size: Size, target: Locator) {
  if (!PHASE) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(400);
  // An element shot scrolls it into view: the phone's pinned top bar would sit across it.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const box = element.getBoundingClientRect();
      const { position } = getComputedStyle(element);
      if ((position === "fixed" || position === "sticky") && box.height < 80 && box.width > 300) element.style.visibility = "hidden";
    }
  });
  await target.screenshot({ path: path.join(SHOT_DIR, `${name}-${WIDTHS[size].width}.png`) });
}

test.describe("Late run Check to-do on screen", () => {
  test("shows the run that ran after the Removal was sent", async ({ adminPage: page, seededData }) => {
    test.setTimeout(300_000);
    const tag = crypto.randomUUID().slice(0, 6).toUpperCase();
    const seeded = await seedLateRun(seededData, tag);
    const batchUrl = `/credit-batches/${seeded.creditBatchId}?facility=${seededData.facility.id}`;
    try {
      for (const size of Object.keys(WIDTHS) as Size[]) {
        await page.setViewportSize(WIDTHS[size]);
        await page.goto(batchUrl);
        if (size === "desktop") await waitForFacilityHydration(page, seededData.facility.name);
        const title = `${seeded.runCode} ran after ${seeded.removalCode} was sent`;
        if (PHASE === "before") await expect(page.getByRole("region", { name: /Open to-dos/ })).toBeVisible({ timeout: 30_000 });
        else {
          await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
          await expect(page.getByText(/dated Sep 10, 2026\./).first()).toBeVisible();
        }
        await shoot(page, "open-todos", size, page.getByRole("region", { name: /Open to-dos/ }));
      }
    } finally {
      await seeded.cleanup();
    }
  });
});
