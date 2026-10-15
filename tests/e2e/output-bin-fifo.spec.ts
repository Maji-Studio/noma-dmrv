import type { Page, TestInfo } from "@playwright/test";
import { test, expect, selectEntity, waitForFacilityHydration } from "./fixtures";
import {
  FIFO_BROWSER_DATE, FIFO_BROWSER_INSTANT, FIFO_BROWSER_TIME, FIFO_MATCHING_BIN_COUNT,
  seedOutputStockBrowserFixture, readOutputStockBrowserFixture, seedPureBrowserSource,
} from "./helpers/output-stock-browser-fixture";
import { fillStockMoisture } from "./helpers/stock-moisture";

const FLOW_TIMEOUT_MS = 180_000;
const DRAW_ORDER_VIEWPORTS = [{ name: "desktop", width: 1280, height: 900 }, { name: "mobile", width: 390, height: 844 }] as const;
type Fixture = Awaited<ReturnType<typeof seedOutputStockBrowserFixture>>;

async function evidence(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: "image/png" });
}

async function openBin(page: Page, f: Fixture) {
  // The sidebar that signals facility hydration is hidden on mobile, so hydrate at desktop width.
  const viewport = page.viewportSize();
  await page.setViewportSize(DRAW_ORDER_VIEWPORTS[0]);
  await page.goto(`/storage-locations?facility=${f.facility.id}`);
  await waitForFacilityHydration(page, f.facility.name);
  if (viewport) await page.setViewportSize(viewport);
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

  for (const viewport of DRAW_ORDER_VIEWPORTS) {
    test(`sets newest first, shows Next out and saves the default draw (${viewport.name})`, async ({ adminPage: page, testUsers }, info) => {
      await page.setViewportSize(viewport);
      const f = await seedOutputStockBrowserFixture(testUsers.admin.id);
      await openBin(page, f);
      await page.getByRole("button", { name: "Edit storage bin", exact: true }).click();
      const order = page.getByRole("group", { name: "Default draw order", exact: true });
      await expect(order).toBeVisible();
      await expect(order.getByRole("radio", { name: /^Oldest first/ })).toBeChecked();
      await evidence(page, info, `default-draw-order-before-${viewport.name}`);
      await order.getByRole("radio", { name: /^Newest first/ }).locator("..").click();
      await order.getByRole("radio", { name: /^Newest first/ }).focus();
      await evidence(page, info, `default-draw-order-${viewport.name}`);
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openBin(page, f);
      await expect(page.getByRole("dialog").getByText("Newest first", { exact: true })).toBeVisible();
      const nextOut = page.getByRole("list", { name: "Sub-bins, next out first" }).getByRole("listitem").first();
      await expect(nextOut).toContainText("Next out");
      await expect(nextOut).toContainText(f.products[1].code);
      await evidence(page, info, `newest-first-bays-${viewport.name}`);
      await page.getByRole("button", { name: "Adjust stock", exact: true }).click();
      await fillStock(page, "100", "0", "E2E newest-first loss");
      await expect(page.getByText("Newest first", { exact: true })).toBeVisible();
      await expect(page.locator(`[id="stock-moisture-${f.products[1].id}"]`)).toBeVisible();
      await expect(page.locator(`[id="stock-moisture-${f.products[0].id}"]`)).toHaveCount(0);
      await page.getByRole("button", { name: "Change the sub-bins in this load" }).click();
      await expect(page.getByRole("button", { name: "Reset to newest first" })).toBeDisabled();
      await page.getByRole("button", { name: "Use this order", exact: true }).click();
      await page.getByRole("button", { name: "Save lost mass", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const saved = await readOutputStockBrowserFixture(f);
      expect(saved.balance.beforeAllocations?.find(layer => layer.layerId === f.products[0].id)?.dryMassKg).toBe(900);
      // The newer product contains 600 kg biochar in 720 kg solids: 100 kg at 0% removes 83.333 kg biochar.
      expect(saved.balance.beforeAllocations?.find(layer => layer.layerId === f.products[1].id)?.dryMassKg).toBeCloseTo(516.667, 3);
    });
  }

  test("creates a Pure formulation product with an actual placement date and shows its stock", async ({ adminPage: page, testUsers }, info) => {
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
    await expect(page.getByRole("region", { name: "Stock", exact: true })).toContainText("100 kg dry biochar");
    await expect(page.getByRole("button", { name: "Adjust stock", exact: true })).toBeVisible();
    await evidence(page, info, "pure-product-stock");
  });

  test("saves an unreserved formulation order without stock and shows every matching bin", async ({ adminPage: page, testUsers }, info) => {
    const f = await seedOutputStockBrowserFixture(testUsers.admin.id);
    await page.goto(`/orders?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByRole("button", { name: "New order", exact: true }).click();
    await selectEntity(page, "Customer", f.customer.id, f.customer.name);
    await selectEntity(page, "Customer location", f.location.id, f.location.name ?? undefined);
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
    await selectEntity(page, "Actual source bin", f.bin.id, f.bin.name);
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
    await selectEntity(page, "Delivery", delivery.id, delivery.code);
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
    await page.getByRole("button", { name: "History", exact: true }).click();
    const deliveryEntry = page.getByRole("dialog", { name: "Stock history" }).locator("details").filter({ hasText: "Delivery" });
    await deliveryEntry.locator("summary").click();
    await expect(deliveryEntry.getByRole("link", { name: "Open delivery" })).toHaveAttribute("href", `/deliveries?facility=${f.facility.id}&delivery=${delivery.id}`);
    await deliveryEntry.getByRole("link", { name: "Open delivery" }).click();
    await expect(page.getByRole("dialog")).toContainText(delivery.code);
    await evidence(page, info, "delivery-source-from-stock-history");
  });

  test("edits latest Lost mass and locks it after a newer entry", async ({ adminPage: page, testUsers }, info) => {
    const f = await seedOutputStockBrowserFixture(testUsers.admin.id, true);
    await openBin(page, f);
    await page.getByRole("button", { name: "Adjust stock", exact: true }).click();
    await fillStock(page, "120", "30", "E2E FIFO spill");
    await expect(page.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    await expect(page.getByText("120 kg wet lost at 30% moisture", { exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "Detailed", exact: true }).locator("..").click();
    await expect(page.getByText("120 kg wet lost at 30% moisture", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Dry biochar in bin: 350 kg before, 280 kg after" })).toBeVisible();
    await page.getByRole("button", { name: "Save lost mass", exact: true }).last().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await readOutputStockBrowserFixture(f)).balance.beforeDryKg).toBe(280);

    await openBin(page, f);
    await page.getByRole("button", { name: "History", exact: true }).click();
    const history = page.getByRole("dialog", { name: "Stock history", exact: true });
    const loss = history.locator("details").filter({ hasText: "E2E FIFO spill" });
    await loss.locator("summary").click();
    await expect(loss).toContainText("Lost mass");
    await expect(loss).toContainText("280 kg");
    await expect(loss.getByRole("link")).toHaveCount(0);
    await evidence(page, info, "lost-mass-history");
    await loss.getByRole("button", { name: "Edit", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit lost mass", exact: true });
    await expect(edit.locator("#stock-wet")).toHaveValue("120");
    await expect(edit.locator("#stock-reason")).toHaveValue("E2E FIFO spill");
    await edit.locator("#stock-wet").fill("60");
    await edit.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(edit).toHaveCount(0);
    expect((await readOutputStockBrowserFixture(f)).balance.beforeDryKg).toBe(315);
    const corrected = history.locator("details").filter({ hasText: "Correction" }).first();
    await corrected.locator("summary").click();
    await expect(corrected).toContainText("Original");
    await expect(corrected).toContainText("Corrected");
    await evidence(page, info, "lost-mass-corrected");

    await openBin(page, f);
    await page.getByRole("button", { name: "Adjust stock", exact: true }).click();
    await fillStock(page, "10", "30", "E2E newer FIFO spill");
    await page.getByRole("button", { name: "Save lost mass", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await openBin(page, f);
    await page.getByRole("button", { name: "History", exact: true }).click();
    const locked = history.locator("details").filter({ hasText: "Correction" }).first();
    await locked.locator("summary").click();
    await expect(locked.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(locked).toContainText("Locked because newer stock entries were recorded on this bin after it.");
    await evidence(page, info, "lost-mass-locked");
  });
});
