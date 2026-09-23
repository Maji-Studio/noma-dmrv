import { test, expect } from "./fixtures";
import { waitForFacilityHydration, waitForSideSheet } from "./fixtures/page-helpers";

import { createDbConnection } from "./fixtures/db";
import * as schema from "../../src/db/schema";
import { DEC_ORG_ID } from "@/db/org-defaults";

const FORM_SURFACES = [
  { route: "deliveries", create: "New Delivery" },
  { route: "applications", create: "New Application" },
  { route: "production-runs", create: "New Production Run" },
  { route: "feedstocks", create: "New Feedstock" },
];
const VIEWPORTS = [
  { width: 1440, height: 1100 },
  { width: 390, height: 844 },
];
const LAYOUT_TOLERANCE_PX = 2;

for (const viewport of VIEWPORTS) {
  test(`detail controls share the header and preserve clean forms at ${viewport.width}px`, async ({ adminPage: page, seededData }, testInfo) => {
    test.setTimeout(180_000);
    // Keep catalogue choices ambiguous: automatic single-option selection is a
    // real form-value change, unrelated to the presentation switch under test.
    const { db, pool } = createDbConnection();
    try {
      await db.insert(schema.feedstockTypes).values({
        organizationId: DEC_ORG_ID,
        code: `E2E-FST-DETAIL-${crypto.randomUUID().slice(0, 8)}`,
        name: `E2E Alternative detail material ${crypto.randomUUID().slice(0, 8)}`,
        category: "wood",
        usage: "pyrolysis",
      });
    } finally { await pool.end(); }
    for (const surface of FORM_SURFACES) {
      await page.setViewportSize(VIEWPORTS[0]);
      await page.goto(`/${surface.route}?facility=${seededData.facility.id}`);
      await waitForFacilityHydration(page, seededData.facility.name);
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: surface.create, exact: true }).click();
      await waitForSideSheet(page);
      const sheet = page.getByRole("dialog").first();
      const simple = sheet.getByRole("radio", { name: "Simple", exact: true });
      const detailed = sheet.getByRole("radio", { name: "Detailed", exact: true });
      await expect(simple).toBeChecked();
      // A newly opened form must also close cleanly before any presentation change.
      await sheet.getByRole("button", { name: "Close panel", exact: true }).click();
      await expect(sheet).not.toBeVisible();
      await page.getByRole("button", { name: surface.create, exact: true }).click();
      await waitForSideSheet(page);
      const heading = sheet.getByRole("heading").first();
      const control = sheet.locator("[data-presentation-control]");
      const titleBox = await heading.boundingBox();
      const controlBox = await control.boundingBox();
      expect(titleBox).not.toBeNull();
      expect(controlBox).not.toBeNull();
      expect(controlBox!.y).toBeLessThan(titleBox!.y + titleBox!.height);
      expect(controlBox!.y + controlBox!.height).toBeGreaterThan(titleBox!.y);
      const firstInput = sheet.locator('input:not([type="radio"]):not([type="hidden"])').first();
      const initial = await firstInput.boundingBox();
      await simple.focus();
      await page.keyboard.press("ArrowRight");
      await expect(detailed).toBeChecked();
      const expanded = await firstInput.boundingBox();
      expect(Math.abs(expanded!.y - initial!.y)).toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX);
      expect(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${surface.route}-detailed-${viewport.width}.png`) });
      await sheet.getByRole("button", { name: "Close panel", exact: true }).click();
      await expect(sheet).not.toBeVisible();
      await expect(page.getByText("Discard unsaved changes?", { exact: true })).not.toBeVisible();
      await page.getByRole("button", { name: surface.create, exact: true }).click();
      await waitForSideSheet(page);
      await expect(simple).toBeChecked();
      await sheet.getByRole("button", { name: "Close panel", exact: true }).click();
      await expect(sheet).not.toBeVisible();
    }
  });
}

test("feedstock read and edit reset detail without discarding field changes", async ({ adminPage: page, seededData }, testInfo) => {
  await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
  await waitForFacilityHydration(page, seededData.facility.name);
  await page.locator("table tbody tr", { hasText: seededData.feedstock.code }).first().click();
  await waitForSideSheet(page);
  const sheet = page.getByRole("dialog").first();
  const simple = sheet.getByRole("radio", { name: "Simple", exact: true });
  const detailed = sheet.getByRole("radio", { name: "Detailed", exact: true });
  await expect(simple).toBeChecked();
  await detailed.locator("..").click();
  await page.screenshot({ path: testInfo.outputPath("feedstock-read-detailed.png") });
  await sheet.getByRole("button", { name: "Edit Feedstock", exact: true }).click();
  await expect(simple).toBeChecked();
  const notes = sheet.getByLabel("Notes", { exact: true });
  await notes.fill("E2E detail toggle preserves this edit");
  await detailed.locator("..").click();
  await simple.locator("..").click();
  await expect(notes).toHaveValue("E2E detail toggle preserves this edit");
  await sheet.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(page.getByText("Discard unsaved changes?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(notes).toHaveValue("E2E detail toggle preserves this edit");
  await sheet.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(sheet).not.toBeVisible();
  await page.locator("table tbody tr", { hasText: seededData.feedstock.code }).first().click();
  await waitForSideSheet(page);
  await expect(page.getByRole("button", { name: "Edit Feedstock", exact: true })).toBeVisible();
  await expect(simple).toBeChecked();
  await expect(sheet.getByText("E2E detail toggle preserves this edit", { exact: true })).toBeVisible();
});
