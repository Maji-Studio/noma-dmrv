import type { Page } from "@playwright/test";
import { expect, type SeededChainData } from "../fixtures";
import { selectEntity, waitForSideSheet } from "../fixtures/page-helpers";
import type { ProductionRunStatus } from "@/lib/production-runs/lifecycle";
import { chooseRunStatus } from "./run-status";

export const FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR =
  'input[name="feedstockDraws.0.wetMassKg"]';

export async function openRunForm(
  page: Page,
  seededData: SeededChainData,
  window: {
    startDate: string;
    startTime: string;
    endDate?: string;
    endTime?: string;
    status?: ProductionRunStatus;
    recordOutput?: boolean;
  },
) {
  await page.goto(`/production-runs?facility=${seededData.facility.id}`);
  await expect(
    page.locator("aside").getByText(seededData.facility.name, { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New production run" }).click();
  await waitForSideSheet(page);
  await chooseRunStatus(page, window.status ?? "running");
  await selectEntity(
    page,
    "Reactor",
    seededData.reactor.id,
    seededData.reactor.identifier,
  );
  await page.fill('input[name="startDate"]', window.startDate);
  await page.fill('input[name="startTime"]', window.startTime);
  if (window.endDate) await page.fill('input[name="endDate"]', window.endDate);
  if (window.endTime) await page.fill('input[name="endTime"]', window.endTime);
  if (window.recordOutput) {
    await selectEntity(page, "Source Bin", seededData.feedstockStorageLocation.id, seededData.feedstockStorageLocation.name);
    await page.fill(FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR, "50");
    await page.fill('input[name="feedstockMoisturePercent"]', "15");
    await selectEntity(page, "Biochar Storage", seededData.biocharStorageLocation.id, seededData.biocharStorageLocation.name);
    await page.fill('input[name="biocharOutputKg"]', "10");
    await page.fill('input[name="biocharMoisturePercent"]', "0");
  }
}

export async function submitCreate(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Create production run")')
    .click();
}

export async function editFirstRow(page: Page) {
  // Edit via the row overflow menu (openEdit does not set the deep-link
  // focus that would re-open a view sheet after save, so the sheet closes
  // cleanly). A post-save list refetch can re-render the row and detach the
  // menu's "Edit" item mid-click, so retry the open→Edit sequence instead of
  // waiting for network idle (CI dev servers may never settle within budget).
  // Edit is offered only once the row's lock read answers (#1119); the retry
  // below covers that wait, since an Open row shows no chip to wait for.
  await expect(async () => {
    await page
      .locator("tbody tr")
      .first()
      .getByRole("button", { name: /Actions for/ })
      .click({ timeout: 5000 });
    await page.getByRole("menuitem", { name: "Edit" }).click({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await waitForSideSheet(page);
  await expect(
    page.locator('[role="dialog"] input[name="startTime"]'),
  ).toBeVisible();
}

export async function saveEdit(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Save changes")')
    .click();
}

