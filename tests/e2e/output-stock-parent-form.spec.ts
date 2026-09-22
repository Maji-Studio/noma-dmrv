import { test, expect, selectEntity, waitForFacilityHydration } from "./fixtures";
import {
  FIFO_BROWSER_DATE,
  readOutputStockBrowserFixture,
  seedOutputStockBrowserFixture,
} from "./helpers/output-stock-browser-fixture";

const FLOW_TIMEOUT_MS = 180_000;
const LOSS_REASON = "E2E parent form spill";
const CORRECTION_REASON = "E2E parent form corrected spill";

test("saving a history correction keeps the containing delivery form unsaved", async ({ adminPage: page, testUsers }) => {
  test.setTimeout(FLOW_TIMEOUT_MS);
  const fixture = await seedOutputStockBrowserFixture(testUsers.admin.id, true);
  await page.goto(`/storage-locations?facility=${fixture.facility.id}`);
  await waitForFacilityHydration(page, fixture.facility.name);
  await page.getByPlaceholder("Search by code or name…").fill(fixture.bin.code);
  await page.getByText(fixture.bin.name, { exact: true }).first().click();
  await page.getByRole("button", { name: "Record loss", exact: true }).click();
  await page.locator("#physicalDate").fill(FIFO_BROWSER_DATE);
  await page.locator("#stock-wet").fill("120");
  await page.locator("#stock-moisture").fill("30");
  await page.locator("#stock-reason").fill(LOSS_REASON);
  await page.getByRole("button", { name: "Record loss", exact: true }).last().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const before = await readOutputStockBrowserFixture(fixture);
  expect(before.balance.beforeDryKg).toBe(280);

  await page.goto(`/deliveries?facility=${fixture.facility.id}`);
  await waitForFacilityHydration(page, fixture.facility.name);
  await page.getByRole("button", { name: "New Delivery", exact: true }).click();
  await page.locator("#deliveryDate").fill(FIFO_BROWSER_DATE);
  await selectEntity(page, "Order", fixture.order.id, fixture.order.code);
  await page.locator("#storageLocationId").selectOption(fixture.bin.id);
  await page.locator("#deliveredWetMassKg").fill("10");
  await page.locator("#moistureContentPercent").fill("30");
  const create = page.getByRole("button", { name: "Create Delivery", exact: true });
  await expect(create).toBeEnabled();
  // The preview (and its history trigger) is a Detailed-only surface now.
  await page.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
  await page.getByRole("region", { name: "Stock preview", exact: true })
    .getByRole("button", { name: "Stock history", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Stock history", exact: true });
  await history.locator("article").filter({ hasText: LOSS_REASON })
    .getByRole("button", { name: "Correct entry", exact: true }).click();
  await history.locator("#stock-wet").fill("12");
  await history.locator("#stock-reason").fill(CORRECTION_REASON);
  await history.getByRole("button", { name: "Save correction", exact: true }).click();
  await expect(history.getByText(CORRECTION_REASON, { exact: true }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(history).toHaveCount(0);
  await expect(create).toBeVisible();
  await expect(page.locator("#deliveredWetMassKg")).toHaveValue("10");
  const after = await readOutputStockBrowserFixture(fixture);
  expect(after.deliveries.map(delivery => delivery.id)).toEqual(before.deliveries.map(delivery => delivery.id));
  expect(after.balance.beforeDryKg).toBe(343);
});
