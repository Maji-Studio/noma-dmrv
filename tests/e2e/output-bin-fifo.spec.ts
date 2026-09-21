import type { Page, TestInfo } from "@playwright/test";
import { test, expect, selectEntity, waitForFacilityHydration } from "./fixtures";
import {
  FIFO_BROWSER_DATE, FIFO_MATCHING_BIN_COUNT,
  seedOutputStockBrowserFixture, readOutputStockBrowserFixture, seedPureBrowserSource,
} from "./helpers/output-stock-browser-fixture";

const FLOW_TIMEOUT_MS = 180_000;
type Fixture = Awaited<ReturnType<typeof seedOutputStockBrowserFixture>>;

async function evidence(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: "image/png" });
}

async function openBin(page: Page, f: Fixture) {
  await page.goto(`/storage-locations?facility=${f.facility.id}`);
  await waitForFacilityHydration(page, f.facility.name);
  await page.getByPlaceholder("Search by code or name…").fill(f.bin.code);
  await page.getByText(f.bin.name, { exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function fillStock(page: Page, wet: string, moisture: string, reason: string) {
  await page.locator("#physicalDate").fill(FIFO_BROWSER_DATE);
  await page.locator("#stock-wet").fill(wet);
  await page.locator("#stock-moisture").fill(moisture);
  await page.locator("#stock-reason").fill(reason);
}

test.describe("Output-bin conserved FIFO", () => {
  test.setTimeout(FLOW_TIMEOUT_MS);

  test("creates a Pure formulation product with an actual placement date and treats drying as no loss", async ({ adminPage: page, testUsers }, info) => {
    const f = await seedOutputStockBrowserFixture(testUsers.admin.id);
    await seedPureBrowserSource(f);
    await page.goto(`/biochar-products?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByRole("button", { name: "New Product", exact: true }).click();
    await page.locator("#placedAt").fill(FIFO_BROWSER_DATE);
    await selectEntity(page, "Biochar bin", f.source.id, f.source.name);
    await selectEntity(page, "Formulation", f.pure.id, f.pure.name);
    await selectEntity(page, "Product bin", f.emptyBins[0].id, f.emptyBins[0].name);
    await page.locator('input[name="massKg"]').fill("200");
    await page.locator('input[name="moistureContentPercent"]').fill("50");
    await page.locator("#waterAddedKg").fill("0");
    await page.getByRole("button", { name: "Create Product", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const pureFixture = { ...f, bin: f.emptyBins[0] };
    const saved = await readOutputStockBrowserFixture(pureFixture);
    expect(saved.products).toHaveLength(1);
    expect(saved.products[0].placedAt).toBe(FIFO_BROWSER_DATE);
    expect(saved.balance.beforeDryKg).toBe(100);
    await openBin(page, pureFixture);
    await page.getByRole("button", { name: "Reconcile stock", exact: true }).click();
    await fillStock(page, "100", "0", "E2E drying without dry loss");
    await expect(page.getByText("0 kg dry biochar removed", { exact: true })).toBeVisible();
    await evidence(page, info, "pure-product-drying-no-loss");
    await page.getByRole("button", { name: "Reconcile stock", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await readOutputStockBrowserFixture(pureFixture)).balance.beforeDryKg).toBe(100);
  });

  test("saves an unreserved formulation order without stock and shows every matching bin", async ({ adminPage: page, testUsers }, info) => {
    const f = await seedOutputStockBrowserFixture(testUsers.admin.id);
    await page.goto(`/orders?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByRole("button", { name: "New Order", exact: true }).click();
    await selectEntity(page, "Customer", f.customer.id, f.customer.name);
    await selectEntity(page, "Formulation", f.pure.id, f.pure.name);
    await page.locator("#quantityKg").fill("100");
    await page.locator("#orderDate").fill(FIFO_BROWSER_DATE);
    await page.locator("#packaging").selectOption("loose");
    const matching = page.getByRole("region", { name: "Matching storage bins" });
    await expect(matching.getByRole("article")).toHaveCount(FIFO_MATCHING_BIN_COUNT);
    await expect(matching.getByText(f.emptyBins.at(-1)!.name, { exact: true })).toBeVisible();
    await expect(page.locator("#biocharProductId")).toHaveCount(0);
    await expect(page.locator("#storageLocationId")).toHaveCount(0);
    await evidence(page, info, "unreserved-order-all-matching-bins");
    await page.getByRole("button", { name: "Create Order", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const saved = await readOutputStockBrowserFixture(f);
    expect(saved.orders.some(order => order.formulationId === f.pure.id && order.quantityKg === 100)).toBe(true);
    expect(saved.balance.beforeDryKg).toBe(1500);
  });

  test("blocks a dry shortage, saves a spanning delivery, and applies both batch shares", async ({ adminPage: page, testUsers }, info) => {
    const f = await seedOutputStockBrowserFixture(testUsers.admin.id);
    await page.goto(`/deliveries?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByRole("button", { name: "New Delivery", exact: true }).click();
    await page.locator("#deliveryDate").fill(FIFO_BROWSER_DATE);
    await selectEntity(page, "Order", f.order.id, f.order.code);
    await page.locator("#storageLocationId").selectOption(f.bin.id);
    await expect(page.getByRole("option", { name: /upcoming/i })).toHaveCount(0);
    await page.locator("#deliveredWetMassKg").fill("2500");
    await page.locator("#moistureContentPercent").fill("15");
    const preview = page.getByRole("region", { name: "Stock preview", exact: true });
    await expect(page.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    await expect(preview.getByRole("alert")).toContainText(/Insufficient/);
    await expect(page.getByRole("button", { name: "Create Delivery", exact: true })).toBeDisabled();
    expect((await readOutputStockBrowserFixture(f)).deliveries).toHaveLength(0);

    await page.locator("#deliveredWetMassKg").fill("2000");
    await page.locator("#moistureContentPercent").fill("30");
    await expect(preview.getByText("1,150 kg dry biochar removed", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
    await expect(preview.getByRole("meter", { name: "Before loading stock on common scale" })).toHaveAttribute("aria-valuenow", "2600");
    await expect(preview.getByRole("meter", { name: "After loading stock on common scale" })).toHaveAttribute("aria-valuenow", "600");
    await expect(preview.getByText(`${f.products[0].code}: 900 kg dry biochar`, { exact: true }).last()).toBeVisible();
    await expect(preview.getByText(`${f.products[1].code}: 250 kg dry biochar`, { exact: true })).toBeVisible();
    await preview.getByRole("meter", { name: "After loading stock on common scale" }).scrollIntoViewIfNeeded();
    await evidence(page, info, "spanning-delivery-preview");
    const more = preview.getByRole("button", { name: "More info", exact: true }).first();
    await more.focus();
    await page.keyboard.press("Enter");
    const history = page.getByRole("dialog", { name: "Stock history", exact: true });
    await expect(history).toBeVisible();
    await expect.poll(() => history.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Tab");
    await expect(history).toContainText("Delivery moisture does not update a pile measurement.");
    await expect.poll(() => history.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(history).toHaveCount(0);
    await expect(more).toBeFocused();
    await page.getByRole("button", { name: "Create Delivery", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const saved = await readOutputStockBrowserFixture(f);
    expect(saved.deliveries).toHaveLength(1);
    const delivery = saved.deliveries[0];
    expect(delivery.massDryKg).toBe(1150);
    expect(saved.products.reduce((sum, product) => sum + Number(product.massKg), 0)).toBe(2500);
    expect(saved.balance.beforeDryKg).toBe(350);

    await page.goto(`/applications?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByRole("button", { name: "New Application", exact: true }).click();
    await page.locator("#applicationDate").fill(FIFO_BROWSER_DATE);
    await page.locator("#deliveryId").selectOption(delivery.id);
    await page.locator("#biocharAppliedTons").fill("1000");
    await page.locator("#fieldSizeHa").fill("1");
    await page.getByRole("button", { name: "Create Application", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const [application] = (await readOutputStockBrowserFixture(f)).applications;
    await page.getByRole("table", { name: "Applications", exact: true }).getByText(application.code, { exact: true }).click();
    await expect(page.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    await page.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
    const shares = page.locator('[aria-label="Applied batch and source-run shares"]');
    await expect(shares).toContainText(`${f.products[0].code}: 450 kg dry`);
    await expect(shares).toContainText(`${f.products[1].code}: 125 kg dry`);
    await expect(shares).toContainText("78.261%");
    await expect(shares).toContainText("21.739%");
    await evidence(page, info, "application-batch-run-shares");

    await openBin(page, f);
    await page.getByRole("button", { name: "More info", exact: true }).first().click();
    const deliveryEntry = page.getByRole("dialog", { name: "Stock history" }).locator("article").filter({ has: page.getByRole("heading", { name: "Delivery, original entry", exact: true }) });
    await deliveryEntry.getByRole("button", { name: "Correct entry" }).click();
    await fillStock(page, "1900", "30", "E2E attempted used delivery correction");
    await expect(page.getByRole("dialog", { name: "Stock history" }).getByRole("alert")).toContainText(/application/i);
    await expect(page.getByRole("button", { name: "Save correction", exact: true })).toBeDisabled();
    await evidence(page, info, "named-application-correction-blocker");
  });

  test("reconciles without loss, records and corrects loss, and closes zero without moisture", async ({ adminPage: page, testUsers }, info) => {
    const f = await seedOutputStockBrowserFixture(testUsers.admin.id, true);
    await openBin(page, f);
    await page.getByRole("button", { name: "Reconcile stock", exact: true }).click();
    await fillStock(page, "600", "30", "E2E unchanged measured stock");
    await expect(page.getByText("0 kg dry biochar removed", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reconcile stock", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await readOutputStockBrowserFixture(f)).balance.beforeDryKg).toBe(350);

    await openBin(page, f);
    await page.getByRole("button", { name: "Record loss", exact: true }).click();
    await fillStock(page, "120", "30", "E2E FIFO spill");
    await expect(page.getByText("70 kg dry biochar removed", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Record loss", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await readOutputStockBrowserFixture(f)).balance.beforeDryKg).toBe(280);

    await openBin(page, f);
    await page.getByRole("button", { name: "More info", exact: true }).first().click();
    const history = page.getByRole("dialog", { name: "Stock history", exact: true });
    await history.locator("article").filter({ hasText: "E2E FIFO spill" }).getByRole("button", { name: "Correct entry" }).click();
    await fillStock(page, "12", "30", "E2E corrected spill");
    await expect(history.getByText("7 kg dry biochar removed", { exact: true })).toBeVisible();
    await history.getByRole("button", { name: "Save correction", exact: true }).click();
    await expect(history.getByText("E2E corrected spill", { exact: true }).first()).toBeVisible();
    await expect(history.getByText("E2E FIFO spill", { exact: true })).toBeVisible();
    const reversal = history.locator("article").filter({ has: page.getByRole("heading", { name: /^Reversal, corrects/ }) });
    await expect(reversal).toContainText("120 kg measured wet at 30% moisture");
    await expect(reversal).toContainText("-70 kg dry biochar effect");
    expect((await readOutputStockBrowserFixture(f)).balance.beforeDryKg).toBe(343);
    await evidence(page, info, "immutable-loss-correction-history");

    await openBin(page, f);
    await page.getByRole("button", { name: "Reconcile stock", exact: true }).click();
    await fillStock(page, "0", "", "E2E empty bin count");
    await expect(page.getByText("343 kg dry biochar removed", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reconcile stock", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await readOutputStockBrowserFixture(f)).balance.beforeDryKg).toBe(0);
  });
});
