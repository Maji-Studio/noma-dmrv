import type { Page, TestInfo } from "@playwright/test";
import { test, expect, selectEntity, waitForFacilityHydration } from "./fixtures";
import {
  FIFO_BROWSER_DATE, FIFO_BROWSER_INSTANT, FIFO_BROWSER_TIME, FIFO_MATCHING_BIN_COUNT,
  seedOutputStockBrowserFixture, readOutputStockBrowserFixture, seedPureBrowserSource,
} from "./helpers/output-stock-browser-fixture";
import { fillStockMoisture } from "./helpers/stock-moisture";

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
  await page.locator("#occurredAt").fill(FIFO_BROWSER_TIME);
  await page.locator("#stock-wet").fill(wet);
  await fillStockMoisture(page, "stock", moisture);
  await page.locator("#stock-reason").fill(reason);
}

test.describe("Output-bin conserved FIFO", () => {
  test.setTimeout(FLOW_TIMEOUT_MS);

  test("creates a Pure formulation product with an actual placement date and treats drying as no loss", async ({ adminPage: page, testUsers }, info) => {
    const f = await seedOutputStockBrowserFixture(testUsers.admin.id);
    await seedPureBrowserSource(f);
    await page.goto(`/biochar-products?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByRole("button", { name: "New product", exact: true }).click();
    await page.locator("#placedAt").fill(FIFO_BROWSER_TIME);
    await selectEntity(page, "Biochar bin", f.source.id, f.source.name);
    await selectEntity(page, "Formulation", f.pure.id, f.pure.name);
    await selectEntity(page, "Product bin", f.emptyBins[0].id, f.emptyBins[0].name);
    await page.locator('input[name="massKg"]').fill("200");
    await fillStockMoisture(page, "product-source", "50");
    await page.locator("#waterAddedKg").fill("0");
    await page.getByRole("button", { name: "Create product", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const pureFixture = { ...f, bin: f.emptyBins[0] };
    const saved = await readOutputStockBrowserFixture(pureFixture);
    expect(saved.products).toHaveLength(1);
    expect(saved.products[0].placedAt.toISOString()).toBe(FIFO_BROWSER_INSTANT);
    expect(saved.balance.beforeDryKg).toBe(100);
    await openBin(page, pureFixture);
    await page.getByRole("button", { name: "Reconcile stock", exact: true }).click();
    await fillStock(page, "100", "0", "E2E drying without dry loss");
    await expect(page.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    // The stock preview informs the decision, so Simple shows it.
    await expect(page.getByText("Drying alone does not remove dry biochar.", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
    await expect(page.getByText("Drying alone does not remove dry biochar.", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Dry biochar in bin: 100 kg before, 100 kg after" })).toBeVisible();
    await evidence(page, info, "pure-product-drying-no-loss");
    await page.getByRole("button", { name: "Reconcile stock", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await readOutputStockBrowserFixture(pureFixture)).balance.beforeDryKg).toBe(100);
  });

  test("saves an unreserved formulation order without stock and shows every matching bin", async ({ adminPage: page, testUsers }, info) => {
    const f = await seedOutputStockBrowserFixture(testUsers.admin.id);
    await page.goto(`/orders?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByRole("button", { name: "New order", exact: true }).click();
    await selectEntity(page, "Customer", f.customer.id, f.customer.name);
    await selectEntity(page, "Formulation", f.pure.id, f.pure.name);
    await page.locator("#quantityKg").fill("100");
    await page.locator("#orderDate").fill(FIFO_BROWSER_DATE);
    await page.locator("#packaging").selectOption("loose");
    // Matching stock informs the order, so Simple shows it.
    await expect(page.getByRole("dialog").getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    const matching = page.getByRole("region", { name: "Matching storage bins" });
    await matching.getByRole("button", { name: /Available wet stock, estimate/ }).click();
    const bins = page.getByRole("dialog", { name: "Matching stock" });
    await expect(bins.getByRole("article")).toHaveCount(FIFO_MATCHING_BIN_COUNT);
    await expect(bins.getByText(f.emptyBins.at(-1)!.name, { exact: true })).toBeVisible();
    await expect(page.locator("#biocharProductId")).toHaveCount(0);
    await expect(page.locator("#storageLocationId")).toHaveCount(0);
    await evidence(page, info, "unreserved-order-all-matching-bins");
    await page.keyboard.press("Escape");
    await expect(bins).toHaveCount(0);
    await page.getByRole("button", { name: "Create order", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const saved = await readOutputStockBrowserFixture(f);
    expect(saved.orders.some(order => order.formulationId === f.pure.id && order.quantityKg === 100)).toBe(true);
    expect(saved.balance.beforeDryKg).toBe(1500);
  });

  test("blocks a dry shortage, saves a spanning delivery, and applies both batch shares", async ({ adminPage: page, testUsers }, info) => {
    const f = await seedOutputStockBrowserFixture(testUsers.admin.id);
    await page.goto(`/deliveries?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByRole("button", { name: "New delivery", exact: true }).click();
    await page.locator("#deliveryDate").fill(FIFO_BROWSER_TIME);
    await selectEntity(page, "Order", f.order.id, f.order.code);
    await page.locator("#storageLocationId").selectOption(f.bin.id);
    await expect(page.getByRole("option", { name: /upcoming/i })).toHaveCount(0);
    await page.locator("#deliveredWetMassKg").fill("2500");
    await fillStockMoisture(page, "delivery", "15");
    const preview = page.getByRole("region", { name: "Stock preview", exact: true });
    await expect(page.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    await expect(page.getByRole("alert").filter({ hasText: /^Not enough dry biochar in the selected bin/ })).toHaveCount(1);
    await expect(preview.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create delivery", exact: true })).toBeDisabled();
    expect((await readOutputStockBrowserFixture(f)).deliveries).toHaveLength(0);

    await page.locator("#deliveredWetMassKg").fill("2000");
    await fillStockMoisture(page, "delivery", "30");
    // Simple shows the preview headline and picture; Detailed adds the dry
    // pair and the calculation. Stock history lives on the storage bin.
    await expect(preview.getByText("2,000 kg wet loaded at 30% moisture", { exact: true })).toBeVisible();
    await expect(preview.getByRole("button", { name: "Stock history", exact: true })).toHaveCount(0);
    await expect(preview.getByRole("group", { name: "Dry biochar in bin: 1,500 kg before, 350 kg after" })).toBeHidden();
    await page.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
    // 2,000 kg wet at 30% moisture is 1,400 kg of dry solids, of which 1,150 kg
    // is the dry biochar the bin tracks; the bar names solids for that reason.
    // Wet first: the bin's wet estimate leads, captioned by the load as entered.
    await expect(preview.getByText("Wet stock in bin, estimate", { exact: true })).toBeVisible();
    await expect(preview.getByText("2,000 kg wet loaded at 30% moisture", { exact: true })).toBeVisible();
    await expect(preview.getByText(/Dry solids\s+1,400 kg/)).toBeVisible();
    await expect(preview.getByRole("group", { name: "Dry biochar in bin: 1,500 kg before, 350 kg after" })).toBeVisible();
    const draw = preview.getByRole("table", { name: /^Batches this movement draws from/ });
    await expect(draw).toBeHidden();
    await preview.getByRole("button", { name: /^Show calculation/ }).click();
    await expect(draw.getByRole("row").filter({ hasText: f.products[0].code })).toContainText("900 kg");
    await expect(draw.getByRole("row").filter({ hasText: f.products[1].code })).toContainText("250 kg");
    await expect(draw.getByRole("row").filter({ hasText: "Dry biochar in this movement" })).toContainText("1,150 kg");
    await draw.scrollIntoViewIfNeeded();
    await evidence(page, info, "spanning-delivery-preview");
    await expect(preview.getByRole("button", { name: "Stock history", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Create delivery", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const saved = await readOutputStockBrowserFixture(f);
    expect(saved.deliveries).toHaveLength(1);
    const delivery = saved.deliveries[0];
    expect(delivery.massDryKg).toBe(1150);
    expect(saved.products.reduce((sum, product) => sum + Number(product.massKg), 0)).toBe(2500);
    expect(saved.balance.beforeDryKg).toBe(350);

    await page.goto(`/applications?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByRole("button", { name: "New application", exact: true }).click();
    await page.locator("#applicationDate").fill(FIFO_BROWSER_DATE);
    await page.locator("#deliveryId").selectOption(delivery.id);
    await page.locator("#biocharAppliedTons").fill("1000");
    await page.locator("#fieldSizeHa").fill("1");
    await page.getByRole("button", { name: "Create application", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const [application] = (await readOutputStockBrowserFixture(f)).applications;
    await page.getByRole("table", { name: "Applications", exact: true }).getByText(application.code, { exact: true }).click();
    await expect(page.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    // Dry biochar applied is data: a secondary line under the product mass at both levels.
    await expect(page.getByRole("dialog").getByText("Dry biochar applied", { exact: true })).toBeVisible();
    // Both levels carry the bar and its key line: which batches were applied and
    // how much dry biochar each gave. The ledger's shares are explanation, Detailed only.
    const appliedBar = page.getByRole("dialog").getByRole("img", { name: /^Applied dry biochar/ });
    await expect(appliedBar).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("table", { name: /^Applied batches/ })).toHaveCount(0);
    await page.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
    await expect(page.getByRole("dialog").getByText("Dry biochar applied", { exact: true })).toBeVisible();
    await expect(appliedBar).toBeVisible();
    // The ledger carries the per-batch totals and shares; the disclosure adds
    // only the production runs behind each batch.
    const appliedLedger = page.getByRole("table", { name: /^Applied batches/ });
    await expect(appliedLedger).toContainText(f.products[0].code);
    await expect(appliedLedger).toContainText(f.products[1].code);
    await expect(appliedLedger).toContainText("450 kg");
    await expect(appliedLedger).toContainText("125 kg");
    await page.getByRole("button", { name: "Show calculation for applied batches", exact: true }).click();
    const shares = page.locator('[aria-label="Source production runs per applied batch"]');
    await expect(shares).toBeVisible();
    await expect(shares).toContainText("450 kg");
    await expect(shares).toContainText("125 kg");
    await evidence(page, info, "application-batch-run-shares");

    await openBin(page, f);
    await page.getByRole("button", { name: "Stock history", exact: true }).first().click();
    const deliveryEntry = page.getByRole("dialog", { name: "Stock history" }).locator("article").filter({ has: page.getByRole("heading", { name: "Delivery", exact: true }) });
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
    await expect(page.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    await page.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
    // 600 kg counted against about 583 kg recorded: nothing dried, so no drying notice.
    await expect(page.getByText("Drying alone does not remove dry biochar.", { exact: true })).toBeHidden();
    await expect(page.getByRole("group", { name: "Dry biochar in bin: 350 kg before, 350 kg after" })).toBeVisible();
    await page.getByRole("button", { name: "Reconcile stock", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await readOutputStockBrowserFixture(f)).balance.beforeDryKg).toBe(350);

    await openBin(page, f);
    await page.getByRole("button", { name: "Record loss", exact: true }).click();
    await fillStock(page, "120", "30", "E2E FIFO spill");
    await expect(page.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    await expect(page.getByText("120 kg wet lost at 30% moisture", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
    await expect(page.getByText("120 kg wet lost at 30% moisture", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Dry biochar in bin: 350 kg before, 280 kg after" })).toBeVisible();
    await page.getByRole("button", { name: "Record loss", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await readOutputStockBrowserFixture(f)).balance.beforeDryKg).toBe(280);

    await openBin(page, f);
    await page.getByRole("button", { name: "Stock history", exact: true }).first().click();
    const history = page.getByRole("dialog", { name: "Stock history", exact: true });
    await history.locator("article").filter({ hasText: "E2E FIFO spill" }).getByRole("button", { name: "Correct entry" }).click();
    await fillStock(page, "12", "30", "E2E corrected spill");
    await expect(history.getByText("12 kg wet removed at 30% moisture", { exact: true })).toBeVisible();
    await history.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
    await expect(history.getByText("12 kg wet removed at 30% moisture", { exact: true })).toBeVisible();
    await expect(history.getByRole("group", { name: "Dry biochar in bin: 350 kg before, 343 kg after" })).toBeVisible();
    await history.getByRole("button", { name: "Save correction", exact: true }).click();
    await expect(history.getByText("E2E corrected spill", { exact: true }).first()).toBeVisible();
    await expect(history.getByText("E2E FIFO spill", { exact: true })).toBeVisible();
    const reversedLoss = history.locator("article").filter({ hasText: "E2E FIFO spill" });
    await expect(reversedLoss).toContainText("Reversed");
    await expect(reversedLoss).toContainText("120 kg at 30% moisture");
    await expect(reversedLoss).toContainText("280 kg");
    const replacement = history.locator("article").filter({ hasText: "E2E corrected spill" });
    await expect(replacement).toContainText("Replacement");
    await expect(replacement).toContainText("12 kg at 30% moisture");
    await expect(replacement).toContainText("343 kg");
    await expect(replacement).toContainText(/Reverses the entry recorded /);
    expect((await readOutputStockBrowserFixture(f)).balance.beforeDryKg).toBe(343);
    await evidence(page, info, "immutable-loss-correction-history");

    await openBin(page, f);
    await page.getByRole("button", { name: "Reconcile stock", exact: true }).click();
    await fillStock(page, "0", "", "E2E empty bin count");
    await expect(page.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    // A zero count draws no split. The pile's estimated moisture still gives a
    // wet headline at both levels, so the dry pair stays the Detailed
    // calculation row.
    await expect(page.getByText("Counted 0 kg wet", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Dry biochar in bin: 343 kg before, 0 kg after" })).toBeHidden();
    await page.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
    await expect(page.getByRole("group", { name: "Dry biochar in bin: 343 kg before, 0 kg after" })).toBeVisible();
    await expect(page.getByText("Counted 0 kg wet", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Stock preview", exact: true }).locator("[data-moisture-segment]")).toHaveCount(0);
    await page.getByRole("button", { name: "Reconcile stock", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await readOutputStockBrowserFixture(f)).balance.beforeDryKg).toBe(0);
  });
});
