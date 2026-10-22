/**
 * Side sheet footer pinning: the Save and Cancel row sits on the sheet's
 * bottom edge, on short forms as well as long ones, at desktop and phone width.
 * Covers a direct-child form (supplier), a div-wrapped form (feedstock type)
 * and a long form that scrolls (production run).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { waitForSideSheet } from "./fixtures/page-helpers";

const TALL_DESKTOP = { width: 1440, height: 1200 };
const PHONE = { width: 390, height: 844 };
/** Pixels of tolerance for sub-pixel layout rounding. */
const EDGE_TOLERANCE_PX = 1;

async function expectFooterOnSheetBottom(page: Page) {
  const sheet = page.getByRole("dialog");
  const footer = sheet.locator("[data-sheet-footer]").last();
  await expect(footer).toBeVisible();
  const sheetBox = await sheet.boundingBox();
  const footerBox = await footer.boundingBox();
  expect(sheetBox && footerBox).toBeTruthy();
  const sheetBottom = sheetBox!.y + sheetBox!.height;
  expect(Math.abs(footerBox!.y + footerBox!.height - sheetBottom)).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
}

async function openList(page: Page, path: string, facilityId: string) {
  await page.goto(`/${path}?facility=${facilityId}`);
  await page.waitForLoadState("networkidle");
}

test.describe("Side sheet footer pinning", () => {
  test("a short direct-child form (supplier edit) keeps its actions at the bottom", async ({ adminPage: page, seededData }) => {
    await page.setViewportSize(TALL_DESKTOP);
    await openList(page, "suppliers", seededData.facility.id);
    await page.locator("table tbody tr", { hasText: seededData.supplier.code }).first().click();
    await waitForSideSheet(page);
    await page.getByRole("button", { name: "Edit supplier" }).click();
    await expectFooterOnSheetBottom(page);
  });

  test("a short div-wrapped form (feedstock type create) keeps its actions at the bottom, at both widths", async ({ adminPage: page, seededData }) => {
    for (const viewport of [TALL_DESKTOP, PHONE]) {
      await page.setViewportSize(viewport);
      await openList(page, "feedstock-types", seededData.facility.id);
      await page.getByRole("button", { name: "New feedstock type" }).click();
      await waitForSideSheet(page);
      await expectFooterOnSheetBottom(page);
    }
  });

  test("a long form (production run create) still ends on the bottom edge while it scrolls", async ({ adminPage: page, seededData }) => {
    await page.setViewportSize(PHONE);
    await openList(page, "production-runs", seededData.facility.id);
    await page.getByRole("button", { name: /^New production run/ }).click();
    await waitForSideSheet(page);
    await expectFooterOnSheetBottom(page);
  });
});
