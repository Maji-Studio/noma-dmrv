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
/** The form's space-y-20 margin under the error box; the footer drops its own top margin after it. */
const ERROR_GAP_PX = 20;

async function expectFooterOnSheetBottom(page: Page) {
  const sheet = page.getByRole("dialog");
  const footer = sheet.locator("[data-sheet-footer]").last();
  await expect(footer).toBeVisible();
  await expect
    .poll(async () => {
      const sheetBox = await sheet.boundingBox();
      const footerBox = await footer.boundingBox();
      if (!sheetBox || !footerBox) return Infinity;
      return Math.abs(footerBox.y + footerBox.height - (sheetBox.y + sheetBox.height));
    })
    .toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
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

  test("a long form (production run create) scrolls under its pinned footer", async ({ adminPage: page, seededData }) => {
    await page.setViewportSize(PHONE);
    await openList(page, "production-runs", seededData.facility.id);
    await page.getByRole("button", { name: /^New production run/ }).click();
    await waitForSideSheet(page);
    const sheet = page.getByRole("dialog");
    const body = sheet.locator("div.overflow-y-auto").first();
    await expect.poll(() => body.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
    await expectFooterOnSheetBottom(page);

    const footer = sheet.locator("[data-sheet-footer]").last();
    const lastField = body.locator("input:not([type=hidden]):not([type=file]):not(.sr-only):visible, select:visible, textarea:visible, [role=combobox]:visible").last();
    // Focus scrolls the field in with the footer clearance (WCAG 2.4.11).
    await lastField.focus();
    await expect
      .poll(async () => {
        const fieldBox = await lastField.boundingBox();
        const footerBox = await footer.boundingBox();
        return fieldBox && footerBox ? footerBox.y - (fieldBox.y + fieldBox.height) : -Infinity;
      })
      .toBeGreaterThanOrEqual(0);
  });

  test("the Lost mass sheet pins its actions for a feedstock bin and a biochar bin", async ({ adminPage: page, seededData }) => {
    await page.setViewportSize(TALL_DESKTOP);
    for (const bin of [seededData.feedstockStorageLocation, seededData.biocharStorageLocation]) {
      await openList(page, "storage-locations", seededData.facility.id);
      await page.getByPlaceholder("Search by code or name…").fill(bin.code);
      await page.getByText(bin.name, { exact: true }).first().click();
      await waitForSideSheet(page);
      await page.getByRole("button", { name: "Adjust stock", exact: true }).click();
      await expect(page.getByRole("dialog").locator("[data-sheet-footer]")).toBeVisible();
      await expectFooterOnSheetBottom(page);
    }
  });

  test("a save error stays directly above the pinned buttons on a short form", async ({ adminPage: page, seededData }) => {
    for (const viewport of [TALL_DESKTOP, PHONE]) {
      await page.setViewportSize(viewport);
      await openList(page, "feedstock-types", seededData.facility.id);
      await page.getByRole("button", { name: "New feedstock type" }).click();
      await waitForSideSheet(page);
      const sheet = page.getByRole("dialog");
      await sheet.locator("[data-sheet-footer]").getByRole("button", { name: /^Create/ }).click();
      const errorBox = sheet.locator("[data-form-error-box]:not(:empty)");
      await expect(errorBox).toBeVisible();
      await expectFooterOnSheetBottom(page);
      const footer = sheet.locator("[data-sheet-footer]").last();
      const errorToFooterGap = async () => {
        const errorBoxRect = await errorBox.boundingBox();
        const footerBox = await footer.boundingBox();
        return errorBoxRect && footerBox ? footerBox.y - (errorBoxRect.y + errorBoxRect.height) : Infinity;
      };
      await expect.poll(errorToFooterGap).toBeLessThanOrEqual(ERROR_GAP_PX + EDGE_TOLERANCE_PX);
      // The footer is sticky, so also rule out the error box sliding under it.
      expect(await errorToFooterGap()).toBeGreaterThanOrEqual(-EDGE_TOLERANCE_PX);
    }
  });
});
