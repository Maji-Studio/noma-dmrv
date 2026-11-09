/**
 * An hours entry on a time-based emission line (Isometric `time_based_emissions`:
 * a fixed kgCO2e/hour rate times monitored hours): the operator opens the line on
 * the credit batch Emissions page, adds 12.5 hours and sees them recorded.
 *
 * TIME_ENTRY_SHOTS=before|after saves screenshots under
 * artifacts/time-based-emission-entry/<phase>/ (not committed). In the before
 * phase (code without time support) only the page state is captured. Run with
 * NEXT_PUBLIC_SHOT_MODE=true so the sidebar hides the signed-in email.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { seedTimeBasedLine, TIME_LINE_NAME } from "./fixtures/time-based-emission-seed";
import { waitForFacilityHydration } from "./fixtures/page-helpers";

const PHASE = process.env.TIME_ENTRY_SHOTS;
const SHOT_DIR = path.join(process.cwd(), "artifacts", "time-based-emission-entry", PHASE ?? "after");
const WIDTHS = { desktop: { width: 1440, height: 1000 }, phone: { width: 390, height: 844 } } as const;
type Size = keyof typeof WIDTHS;
const HOURS = "12.5";
// 12.5 h at the template's 0.41264 kgCO2e per hour, to one decimal.
const TOTAL_TEXT = "12.5 h · 5.2 kg CO₂e";

async function shoot(page: Page, name: string, size: Size) {
  if (!PHASE) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}-${WIDTHS[size].width}.png`) });
}

test.describe("Time-based emission line", () => {
  for (const size of Object.keys(WIDTHS) as Size[]) {
    test(`takes an entry in hours at ${WIDTHS[size].width}px`, async ({ adminPage: page, seededData }) => {
      test.setTimeout(300_000);
      const tag = crypto.randomUUID().slice(0, 6).toUpperCase();
      const seeded = await seedTimeBasedLine(seededData, tag);
      const emissionsUrl = `/credit-batches/${seeded.creditBatchId}?facility=${seededData.facility.id}&tab=emissions`;
      try {
        await page.setViewportSize(WIDTHS[size]);
        await page.goto(emissionsUrl);
        if (size === "desktop") await waitForFacilityHydration(page, seededData.facility.name);
        const toggle = page.getByRole("button", { name: TIME_LINE_NAME }).locator("visible=true").first();
        await expect(toggle).toBeVisible({ timeout: 30_000 });
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
        await shoot(page, "emissions-line", size);

        // Before the fix the template reads as incomplete: there is no way to add an entry.
        if (PHASE === "before") return;

        const add = page.getByRole("button", { name: `Add manual entry on ${TIME_LINE_NAME}` }).locator("visible=true").first();
        await expect(add).toBeVisible();
        await add.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toContainText(`${TIME_LINE_NAME}, ${seeded.creditBatchCode}`);
        const hours = dialog.getByRole("textbox", { name: /^Operating hours/ });
        await expect(hours).toBeVisible();
        await expect(dialog.getByText("h", { exact: true })).toBeVisible();
        await shoot(page, "add-entry-form", size);
        await hours.fill(HOURS);
        await dialog.getByRole("button", { name: "Save" }).click();
        await expect(dialog).toBeHidden({ timeout: 30_000 });

        const table = page.getByRole("table", { name: `Sources of ${TIME_LINE_NAME}` }).locator("visible=true").first();
        await expect(table).toContainText("12.5 h", { timeout: 30_000 });
        // The confirmation toast would sit over the line in the shot.
        await page.getByRole("button", { name: /close|dismiss/i }).last().click({ timeout: 2_000 }).catch(() => undefined);
        await table.scrollIntoViewIfNeeded();
        await shoot(page, "line-with-entry", size);

        // The line total repeats the hours with their CO2e (phones show it on the collapsed row).
        if (size === "phone") await toggle.click();
        await expect(page.getByText(TOTAL_TEXT, { exact: true }).locator("visible=true").first()).toBeVisible();
      } finally {
        await seeded.cleanup();
      }
    });
  }
});
