/**
 * Sheet form footer E2E: the FormActions row of an EntitySideSheet create form
 * sits at the bottom edge of the sheet body on short forms (fill-height flex
 * column + `mt-auto!`) and stays in view on long scrolling ones (`sticky`).
 * Creates no data, so there is nothing for the E2E- teardown sweep to clean.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { waitForSideSheet } from "./fixtures";

const EDGE_TOLERANCE_PX = 1;

async function sheetBoxes(page: Page) {
  const footer: Locator = page
    .locator('[role="dialog"] div.sticky.bottom-0')
    .first();
  await expect(footer).toBeVisible();
  const body = footer.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " overflow-y-auto ")][1]',
  );
  const footerBox = await footer.boundingBox();
  const bodyBox = await body.boundingBox();
  const scrolls = await body.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  if (!footerBox || !bodyBox) throw new Error("sheet footer or body not laid out");
  return { footerBox, bodyBox, scrolls };
}

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

for (const size of sizes) {
  test.describe(`Sheet form footer (${size.name})`, () => {
    test.beforeEach(async ({ adminPage: page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
    });

    test("short form: Create feedstock type buttons sit at the sheet bottom", async ({
      adminPage: page,
    }) => {
      await page.goto("/feedstock-types");
      await page.getByRole("button", { name: "New feedstock type" }).first().click();
      await waitForSideSheet(page);
      const { footerBox, bodyBox, scrolls } = await sheetBoxes(page);
      expect(scrolls).toBe(false);
      expect(Math.abs(footerBox.y + footerBox.height - (bodyBox.y + bodyBox.height))).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
    });

    test("short form: Create order buttons sit at the sheet bottom", async ({
      adminPage: page,
      seededData,
    }) => {
      await page.goto(`/orders?facility=${seededData.facility.id}`);
      await page.getByRole("button", { name: /New order/i }).first().click();
      await waitForSideSheet(page);
      const { footerBox, bodyBox } = await sheetBoxes(page);
      expect(Math.abs(footerBox.y + footerBox.height - (bodyBox.y + bodyBox.height))).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
    });

    test("long form: production run footer stays in view while the body scrolls", async ({
      adminPage: page,
      seededData,
    }) => {
      await page.goto(`/production-runs?facility=${seededData.facility.id}`);
      await page.getByRole("button", { name: "New production run" }).click();
      await waitForSideSheet(page);
      const { footerBox, bodyBox, scrolls } = await sheetBoxes(page);
      expect(scrolls).toBe(true);
      expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(size.height + EDGE_TOLERANCE_PX);
      expect(Math.abs(footerBox.y + footerBox.height - (bodyBox.y + bodyBox.height))).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
    });
  });
}
