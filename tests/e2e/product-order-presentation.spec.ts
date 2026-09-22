import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { test, expect, type SeededChainData } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { selectEntity, waitForFacilityHydration } from "./fixtures/page-helpers";
import { deleteOutputProductFixtures } from "../helpers/output-contract-fixtures";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { biocharProducts, biocharProductSourceAllocations, productIngredientSnapshots, feedstocks, binMovements, feedstockTypes, formulationIngredients, formulations, orders, productionRuns, storageLocations } from "@/db/schema";

const NARROW_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1440, height: 1100 };
const SOURCE_MOISTURE = 20;
const SOURCE_DRAW_KG = 250;
const WATER_ADDED_KG = 50;
const INGREDIENT_DRAW_KG = 100;
const INGREDIENT_MOISTURE = 20;
const FIRST_LOT_WET_KG = 100;
const SECOND_LOT_WET_KG = 300;
const PRODUCT_TOTAL_KG = SOURCE_DRAW_KG + WATER_ADDED_KG + INGREDIENT_DRAW_KG;

async function openForm(page: Page, data: SeededChainData, entity: "Product" | "Order") {
  await page.goto(`/${entity === "Product" ? "biochar-products" : "orders"}?facility=${data.facility.id}`);
  await waitForFacilityHydration(page, data.facility.name);
  await page.getByRole("button", { name: `New ${entity}`, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
  return dialog;
}

function entityTrigger(dialog: Locator, label: string) {
  return dialog.locator("label").filter({ hasText: label }).first()
    .locator("xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]")
    .getByTestId("entity-select-trigger");
}

async function showDetailsWithKeyboard(dialog: Locator) {
  await dialog.getByRole("radio", { name: "Simple", exact: true }).focus();
  await dialog.getByRole("radio", { name: "Simple", exact: true }).press("ArrowRight");
  await expect(dialog.getByRole("radio", { name: "Detailed", exact: true })).toBeChecked();
}

async function capture(page: Page, name: string) {
  const info = test.info();
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await info.attach(name, { path, contentType: "image/png" });
}

async function assertSimplePresentation(dialog: Locator) {
  await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
  await expect(dialog.getByRole("region", { name: /composition|stock/i })).toHaveCount(0);
  await expect(dialog.getByRole("table")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /More info|View source lots|Show details for/i })).toHaveCount(0);
  await expect(dialog.getByText(/^(Dry biochar|Wet total|Final moisture|Current stock|Derived transport)$/i)).toHaveCount(0);
}

async function captureSimple(page: Page, dialog: Locator, name: string) {
  await assertSimplePresentation(dialog);
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await dialog.getByText("Simple", { exact: true }).scrollIntoViewIfNeeded();
  await capture(page, `${name}-simple-desktop`);
  await page.setViewportSize(NARROW_VIEWPORT);
  await assertNoHorizontalOverflow(dialog);
  await capture(page, `${name}-simple-narrow`);
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

async function assertNoHorizontalOverflow(dialog: Locator) {
  expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}

async function seedProductScenario(data: SeededChainData) {
  const { db, pool } = createDbConnection();
  const tag = randomUUID().slice(0, 8);
  const formulationId = randomUUID();
  const emptyBinId = randomUUID();
  const destinationId = randomUUID();
  const alternateIngredientBinId = randomUUID();
  const alternateIntakeId = randomUUID();
  const ingredientName = `E2E Chicken manure ${tag}`;
  const formulationName = `E2E Presentation blend ${tag}`;
  const firstCode = `E2E-PRESENT-OLD-${tag}`;
  const secondCode = `E2E-PRESENT-NEW-${tag}`;
  try {
    await db.transaction(async tx => {
      await tx.update(feedstockTypes).set({ usage: "blend", name: ingredientName }).where(eq(feedstockTypes.id, data.feedstockType.id));
      await tx.insert(formulations).values({ id: formulationId, organizationId: DEC_ORG_ID, code: `E2E-PRESENT-FORM-${tag}`, name: formulationName, biocharRatio: 0.5 });
      await tx.insert(formulationIngredients).values({ organizationId: DEC_ORG_ID, formulationId, feedstockTypeId: data.feedstockType.id, ratio: 0.5 });
      await tx.insert(storageLocations).values([
        { id: emptyBinId, organizationId: DEC_ORG_ID, facilityId: data.facility.id, code: `E2E-PRESENT-EMPTY-${tag}`, name: `E2E Empty biochar ${tag}`, type: "biochar_bin" },
        { id: alternateIngredientBinId, organizationId: DEC_ORG_ID, facilityId: data.facility.id, code: `E2E-PRESENT-ALT-${tag}`, name: `E2E Alternate ingredient ${tag}`, type: "feedstock_bin", feedstockTypeId: data.feedstockType.id },
        { id: destinationId, organizationId: DEC_ORG_ID, facilityId: data.facility.id, code: `E2E-PRESENT-DEST-${tag}`, name: `E2E Blend destination ${tag}`, type: "product_bin", formulationId },
      ]);
      await tx.insert(feedstocks).values({ id: alternateIntakeId, organizationId: DEC_ORG_ID, facilityId: data.facility.id, code: `E2E-PRESENT-INTAKE-${tag}`, feedstockDeliveryId: data.feedstockDelivery.id, supplierId: data.supplier.id, deliveryDate: new Date("2025-01-01T00:00:00Z"), feedstockTypeId: data.feedstockType.id, storageLocationId: alternateIngredientBinId, status: "complete", massWetKg: 200, massDryKg: 160, moistureContentPercent: INGREDIENT_MOISTURE });
      // Insert in reverse date order: FIFO must follow eligibility dates, not insertion order.
      await tx.insert(productionRuns).values([
        { organizationId: DEC_ORG_ID, facilityId: data.facility.id, reactorId: data.reactor.id, biocharStorageLocationId: data.biocharStorageLocation.id, code: secondCode, status: "complete", startTime: new Date("2025-01-03T00:00:00Z"), endTime: new Date("2025-01-03T01:00:00Z"), biocharOutputKg: SECOND_LOT_WET_KG, biocharDryMassKg: 240, biocharMoisturePercent: SOURCE_MOISTURE },
        { organizationId: DEC_ORG_ID, facilityId: data.facility.id, reactorId: data.reactor.id, biocharStorageLocationId: data.biocharStorageLocation.id, code: firstCode, status: "complete", startTime: new Date("2025-01-02T00:00:00Z"), endTime: new Date("2025-01-02T01:00:00Z"), biocharOutputKg: FIRST_LOT_WET_KG, biocharDryMassKg: 80, biocharMoisturePercent: SOURCE_MOISTURE },
      ]);
    });
    return { formulationId, formulationName, emptyBinId, destinationId, alternateIngredientBinId, alternateIntakeId, ingredientName, firstCode, secondCode };
  } finally {
    await pool.end();
  }
}

test("product inline presentation preserves measured inputs and guards actual stock changes", async ({ adminPage: page, seededData }) => {
  const scenario = await seedProductScenario(seededData);
  try {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const dialog = await openForm(page, seededData, "Product");
    await selectEntity(page, "Biochar bin", seededData.biocharStorageLocation.id, seededData.biocharStorageLocation.name);
    await dialog.locator('input[name="massKg"]').fill(String(SOURCE_DRAW_KG));
    await dialog.locator('input[name="moistureContentPercent"]').fill(String(SOURCE_MOISTURE));
    await dialog.locator('input[name="waterAddedKg"]').fill(String(WATER_ADDED_KG));
    await selectEntity(page, "Formulation", scenario.formulationId, scenario.formulationName);
    await selectEntity(page, scenario.ingredientName, seededData.feedstockStorageLocation.id, seededData.feedstockStorageLocation.name);
    await dialog.locator('input[name="ingredientBins.0.massKg"]').fill(String(INGREDIENT_DRAW_KG));
    await dialog.locator('input[name="ingredientBins.0.moistureContentPercent"]').fill(String(INGREDIENT_MOISTURE));
    await selectEntity(page, "Product bin", scenario.destinationId);

    const sourceTrigger = entityTrigger(dialog, "Biochar bin");
    const destinationTrigger = entityTrigger(dialog, "Product bin");
    await expect(sourceTrigger).toContainText("−250 kg wet");
    await expect(entityTrigger(dialog, scenario.ingredientName)).toContainText("−100 kg wet");
    await expect(destinationTrigger).toContainText(`+${PRODUCT_TOTAL_KG} kg wet`);
    await expect(dialog.getByRole("region", { name: /composition/ })).toHaveCount(0);
    await captureSimple(page, dialog, "product");

    await showDetailsWithKeyboard(dialog);
    const source = dialog.getByRole("region", { name: "Source composition", exact: true });
    const product = dialog.getByRole("region", { name: "Product composition", exact: true });
    await expect(source).toBeVisible();
    await expect(source.getByRole("button", { name: "Show details for source composition", exact: true }).locator("span")).toHaveCSS("text-transform", "none");
    await expect(product.getByRole("row", { name: /Dry biochar/ })).toContainText("200 kg");
    await expect(product.getByRole("row", { name: new RegExp(`${scenario.ingredientName}.*dry`) })).toContainText("80 kg");
    await expect(product.getByRole("row", { name: "Wet total", exact: false })).toContainText("400 kg");
    await expect(source.getByText(scenario.firstCode, { exact: false })).toBeHidden();
    await source.scrollIntoViewIfNeeded();
    await capture(page, "product-source-composition");
    const ingredient = dialog.getByRole("region", { name: `${scenario.ingredientName} composition`, exact: true });
    await expect(ingredient.getByRole("row", { name: new RegExp(`${scenario.ingredientName}.*dry`) })).toContainText("80 kg");
    await ingredient.scrollIntoViewIfNeeded();
    await capture(page, "product-ingredient-composition");
    await source.getByRole("button", { name: "Show details for source composition", exact: true }).click();
    await source.scrollIntoViewIfNeeded();
    await capture(page, "product-source-details");
    await expect(source.getByText(`${scenario.firstCode}: 80 kg dry biochar`, { exact: true }).first()).toBeVisible();
    await expect(source.getByText(`${scenario.secondCode}: 120 kg dry biochar`, { exact: true }).first()).toBeVisible();
    await capture(page, "product-source-fifo");
    await source.getByRole("button", { name: "View source lots", exact: true }).click();
    const sourceHistory = page.getByRole("dialog", { name: "Stock history", exact: true });
    await expect(sourceHistory).toBeVisible();
    await capture(page, "product-source-lots");
    await page.keyboard.press("Escape");
    await expect(sourceHistory).toBeHidden();
    await source.getByRole("button", { name: "Hide details for source composition", exact: true }).click();
    await product.scrollIntoViewIfNeeded();
    await capture(page, "product-detailed-desktop");
    await product.getByRole("button", { name: "Show details for product composition", exact: true }).click();
    const productDetailsId = await product.getByRole("button", { name: "Hide details for product composition", exact: true }).getAttribute("aria-controls");
    if (!productDetailsId) throw new Error("Product details require an associated disclosure");
    await dialog.locator(`[id="${productDetailsId}"]`).scrollIntoViewIfNeeded();
    await expect(product.getByText("Drawn from the oldest lot first", { exact: true })).toHaveCount(0);
    await capture(page, "product-final-details");
    await product.getByRole("button", { name: "Hide details for product composition", exact: true }).click();

    await dialog.getByText("Simple", { exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    await expect(dialog.locator('input[name="massKg"]')).toHaveValue("250");
    await expect(dialog.locator('input[name="waterAddedKg"]')).toHaveValue("50");
    await expect(dialog.locator('input[name="ingredientBins.0.massKg"]')).toHaveValue("100");
    await expect(dialog.locator('input[name="ingredientBins.0.moistureContentPercent"]')).toHaveValue("20");

    for (const invalid of ["", "-1", "401"]) {
      await dialog.locator('input[name="massKg"]').fill(invalid);
      await expect(sourceTrigger).not.toContainText(/\([−-][\d,.]+ kg wet\)/);
      await expect(destinationTrigger).not.toContainText(/\(\+[\d,.]+ kg wet\)/);
    }
    await expect(dialog.locator("#massKg-error")).toBeVisible();
    await showDetailsWithKeyboard(dialog);
    await expect(dialog.locator("#massKg-error")).toBeVisible();
    await dialog.getByText("Simple", { exact: true }).click();
    await expect(dialog.locator("#massKg-error")).toBeVisible();
    await dialog.locator('input[name="massKg"]').fill("250");
    await expect(destinationTrigger).toContainText("+400 kg wet");
    await dialog.locator('input[name="ingredientBins.0.massKg"]').fill("121");
    await expect(entityTrigger(dialog, scenario.ingredientName)).not.toContainText(/\([−-][\d,.]+ kg wet\)/);
    await expect(destinationTrigger).not.toContainText(/\(\+[\d,.]+ kg wet\)/);
    await dialog.locator('input[name="ingredientBins.0.massKg"]').fill("100");
    await expect(destinationTrigger).toContainText("+400 kg wet");
    await selectEntity(page, "Biochar bin", scenario.emptyBinId);
    await expect(sourceTrigger).not.toContainText("−250 kg wet");
    await expect(destinationTrigger).not.toContainText("+400 kg wet");
    await selectEntity(page, "Biochar bin", seededData.biocharStorageLocation.id);
    await expect(destinationTrigger).toContainText("+400 kg wet");

    await selectEntity(page, scenario.ingredientName, scenario.alternateIngredientBinId);
    await dialog.locator('input[name="ingredientBins.0.massKg"]').fill("125");
    await expect(entityTrigger(dialog, scenario.ingredientName)).toContainText("−125 kg wet");
    await expect(destinationTrigger).toContainText("+425 kg wet");
    await dialog.locator('input[name="ingredientBins.0.massKg"]').fill("100");
    await expect(destinationTrigger).toContainText("+400 kg wet");

    await page.setViewportSize(NARROW_VIEWPORT);
    await showDetailsWithKeyboard(dialog);
    await assertNoHorizontalOverflow(dialog);
    await product.scrollIntoViewIfNeeded();
    await capture(page, "product-detailed-narrow");
    await dialog.getByRole("button", { name: "Create Product", exact: true }).click();
    await expect(dialog).toBeHidden();
    const savedConnection = createDbConnection();
    try {
      const saved = await savedConnection.db.select().from(biocharProducts).where(eq(biocharProducts.storageLocationId, scenario.destinationId));
      expect(saved).toHaveLength(1);
      expect(saved[0].massKg).toBe(350);
      expect(saved[0].waterAddedKg).toBe(WATER_ADDED_KG);
      const sources = await savedConnection.db.select().from(biocharProductSourceAllocations).where(eq(biocharProductSourceAllocations.biocharProductId, saved[0].id));
      expect(sources.map(source => source.allocatedDryMassKg).sort((a, b) => a - b)).toEqual([80, 120]);
      const ingredients = await savedConnection.db.select().from(productIngredientSnapshots).where(eq(productIngredientSnapshots.biocharProductId, saved[0].id));
      expect(ingredients).toHaveLength(1);
      expect(Number(ingredients[0].drySolidsKg)).toBe(80);

      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.locator("tbody").getByText(saved[0].code, { exact: true }).click();
      await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
      await expect(dialog.getByRole("region", { name: /composition/ })).toHaveCount(0);
      await captureSimple(page, dialog, "product-read");
      await showDetailsWithKeyboard(dialog);
      const savedComposition = dialog.getByRole("region", { name: "Product composition", exact: true });
      await expect(savedComposition.getByRole("row", { name: /Dry biochar/ })).toContainText("200 kg");
      await expect(savedComposition.getByRole("row", { name: new RegExp(`${scenario.ingredientName}.*dry`) })).toContainText("80 kg");
      await expect(savedComposition.getByRole("row", { name: "Wet total", exact: false })).toContainText("400 kg");
      await savedComposition.scrollIntoViewIfNeeded();
      await capture(page, "product-read-detailed");
      await page.setViewportSize(NARROW_VIEWPORT);
      await assertNoHorizontalOverflow(dialog);
      await savedComposition.scrollIntoViewIfNeeded();
      await capture(page, "product-read-narrow");
      await page.setViewportSize(DESKTOP_VIEWPORT);

      await dialog.getByRole("button", { name: "Edit Product", exact: true }).click();
      await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
      await expect(dialog.locator('input[name="massKg"]')).toHaveValue("250");
      await expect(dialog.locator('input[name="massKg"]')).toBeDisabled();
      await captureSimple(page, dialog, "product-edit");
      await showDetailsWithKeyboard(dialog);
      await expect(dialog.getByRole("region", { name: "Product composition", exact: true })).toContainText("400 kg");
      await dialog.getByRole("region", { name: "Product composition", exact: true }).scrollIntoViewIfNeeded();
      await capture(page, "product-edit-detailed");
      await page.setViewportSize(NARROW_VIEWPORT);
      await assertNoHorizontalOverflow(dialog);
      await dialog.getByRole("region", { name: "Product composition", exact: true }).scrollIntoViewIfNeeded();
      await capture(page, "product-edit-narrow");
      await page.setViewportSize(DESKTOP_VIEWPORT);
      // Changing presentation alone must not trigger the unsaved-input guard.
      await dialog.getByRole("button", { name: "Back to view", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Edit Product", exact: true })).toBeVisible();
      await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
      await dialog.getByRole("button", { name: "Edit Product", exact: true }).click();
      await dialog.locator('input[name="densityKgM3"]').fill("300");
      await showDetailsWithKeyboard(dialog);
      await dialog.getByText("Simple", { exact: true }).click();
      await expect(dialog.locator('input[name="densityKgM3"]')).toHaveValue("300");
      await expect(dialog.locator('input[name="massKg"]')).toHaveValue("250");
      await expect(dialog.locator('input[name="ingredientBins.0.massKg"]')).toHaveValue("100");
      await expect(entityTrigger(dialog, "Product bin")).not.toContainText(/\(\+[\d,.]+ kg wet\)/);
      await dialog.getByRole("button", { name: "Save Changes", exact: true }).click();
      await expect(dialog).toBeHidden();
      const [updated] = await savedConnection.db.select().from(biocharProducts).where(eq(biocharProducts.id, saved[0].id));
      expect(updated.densityKgM3).toBe(300);
      const unchangedSources = await savedConnection.db.select().from(biocharProductSourceAllocations).where(eq(biocharProductSourceAllocations.biocharProductId, saved[0].id));
      expect(unchangedSources).toEqual(sources);
    } finally { await savedConnection.pool.end(); }
  } finally {
    const { db, pool } = createDbConnection();
    try {
      await deleteOutputProductFixtures(db, eq(biocharProducts.storageLocationId, scenario.destinationId));
      await db.delete(binMovements).where(eq(binMovements.storageLocationId, scenario.destinationId));
      await db.delete(feedstocks).where(eq(feedstocks.id, scenario.alternateIntakeId));
      await db.delete(storageLocations).where(eq(storageLocations.id, scenario.alternateIngredientBinId));
      await db.delete(storageLocations).where(eq(storageLocations.id, scenario.emptyBinId));
      await db.delete(storageLocations).where(eq(storageLocations.id, scenario.destinationId));
      await db.delete(formulations).where(eq(formulations.id, scenario.formulationId));
    } finally { await pool.end(); }
  }
});

test("order details show actual dry stock and saving requested wet mass does not reserve it", async ({ adminPage: page, seededData }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const dialog = await openForm(page, seededData, "Order");
  await selectEntity(page, "Customer", seededData.customer.id, seededData.customer.name);
  await selectEntity(page, "Formulation", seededData.formulation.id, seededData.formulation.name);
  await dialog.locator('input[name="quantityKg"]').fill("125.125");
  await dialog.locator('input[name="value"]').fill("230");
  await expect(dialog.getByRole("region", { name: "Matching storage bins" })).toHaveCount(0);
  await expect(entityTrigger(dialog, "Formulation")).not.toContainText("125");
  await captureSimple(page, dialog, "order");
  await showDetailsWithKeyboard(dialog);
  const stock = dialog.getByRole("region", { name: "Matching storage bins" });
  await expect(stock).toContainText(seededData.productStorageLocation.name);
  expect(await dialog.locator('input[name="currency"]').evaluate((field) => {
    const stock = document.querySelector('[aria-label="Matching storage bins"]');
    return stock !== null && Boolean(field.compareDocumentPosition(stock) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await expect(stock).toContainText("90,000 kg");
  await expect(stock).toContainText(/dry biochar/);
  await expect(stock).toContainText(/do not reserve stock/);
  const stockExplanation = stock.getByText(/Wet availability depends on measured departure moisture\./);
  await expect(stockExplanation).toBeHidden();
  const stockDetails = stock.getByRole("button", { name: `Show details for ${seededData.productStorageLocation.name.toLowerCase()}`, exact: true });
  await stockDetails.focus();
  await page.keyboard.press("Enter");
  await expect(stockExplanation).toBeVisible();
  await stock.scrollIntoViewIfNeeded();
  await capture(page, "order-stock-details");
  await expect(stock.getByRole("button", { name: `Hide details for ${seededData.productStorageLocation.name.toLowerCase()}`, exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Enter");
  await expect(stockExplanation).toBeHidden();
  await expect(stock.getByText("Loading stock details...", { exact: true })).toBeHidden();
  await capture(page, "order-detailed-desktop");
  await dialog.locator('input[name="value"]').scrollIntoViewIfNeeded();
  const valueBox = await dialog.locator('input[name="value"]').boundingBox();
  const currencyBox = await dialog.locator('input[name="currency"]').boundingBox();
  const packagingBox = await dialog.locator('select[name="packaging"]').boundingBox();
  expect(valueBox).not.toBeNull();
  expect(currencyBox).not.toBeNull();
  expect(packagingBox).not.toBeNull();
  expect(Math.abs(valueBox!.y - currencyBox!.y)).toBeLessThanOrEqual(1);
  expect(packagingBox!.y).toBeLessThan(valueBox!.y);
  await capture(page, "order-fields-desktop");
  await dialog.getByText("Simple", { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
  await expect(dialog.locator('input[name="quantityKg"]')).toHaveValue("125.125");
  await expect(dialog.locator('input[name="value"]')).toHaveValue("230");
  await page.setViewportSize(NARROW_VIEWPORT);
  await showDetailsWithKeyboard(dialog);
  await assertNoHorizontalOverflow(dialog);
  await stock.scrollIntoViewIfNeeded();
  await capture(page, "order-detailed-narrow");

  const { db, pool } = createDbConnection();
  try {
    const before = await db.select().from(binMovements).where(eq(binMovements.storageLocationId, seededData.productStorageLocation.id));
    await dialog.getByRole("button", { name: "Create Order", exact: true }).click();
    await expect(dialog).toBeHidden();
    const saved = await db.select().from(orders).where(eq(orders.facilityId, seededData.facility.id));
    expect(saved).toHaveLength(1);
    expect(saved[0].quantityKg).toBe(125.125);
    const after = await db.select().from(binMovements).where(eq(binMovements.storageLocationId, seededData.productStorageLocation.id));
    expect(after).toEqual(before);

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.locator("tbody").getByText(saved[0].code, { exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    await expect(dialog.getByRole("region", { name: "Matching storage bins" })).toHaveCount(0);
    await expect(dialog.getByText("125.125 kg", { exact: true })).toBeVisible();
    await captureSimple(page, dialog, "order-read");
    const readValueBox = await dialog.getByText("Order value", { exact: true }).boundingBox();
    const readCurrencyBox = await dialog.getByText("Currency", { exact: true }).boundingBox();
    const readPackagingBox = await dialog.getByText("Packaging", { exact: true }).boundingBox();
    expect(readValueBox).not.toBeNull();
    expect(readCurrencyBox).not.toBeNull();
    expect(readPackagingBox).not.toBeNull();
    expect(Math.abs(readValueBox!.y - readCurrencyBox!.y)).toBeLessThanOrEqual(1);
    expect(readPackagingBox!.y).toBeLessThan(readValueBox!.y);
    await showDetailsWithKeyboard(dialog);
    await expect(stock).toContainText("90,000 kg");
    await expect(stock).toContainText(/dry biochar/);
    await stock.scrollIntoViewIfNeeded();
    await capture(page, "order-read-detailed");
    await page.setViewportSize(NARROW_VIEWPORT);
    await assertNoHorizontalOverflow(dialog);
    await stock.scrollIntoViewIfNeeded();
    await capture(page, "order-read-narrow");
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await dialog.getByRole("button", { name: "Edit Order", exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    await expect(dialog.locator('input[name="quantityKg"]')).toHaveValue("125.125");
    await captureSimple(page, dialog, "order-edit");
    await showDetailsWithKeyboard(dialog);
    await stock.scrollIntoViewIfNeeded();
    await capture(page, "order-edit-detailed");
    await page.setViewportSize(NARROW_VIEWPORT);
    await assertNoHorizontalOverflow(dialog);
    await stock.scrollIntoViewIfNeeded();
    await capture(page, "order-edit-narrow");
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await dialog.getByRole("button", { name: "Back to view", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Edit Order", exact: true })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Simple", exact: true })).toBeChecked();
    await dialog.getByRole("button", { name: "Edit Order", exact: true }).click();
    await dialog.locator('input[name="quantityKg"]').fill("130.125");
    await showDetailsWithKeyboard(dialog);
    await expect(stock).toContainText("90,000 kg");
    await dialog.getByText("Simple", { exact: true }).click();
    await expect(dialog.locator('input[name="quantityKg"]')).toHaveValue("130.125");
    await expect(dialog.locator('input[name="value"]')).toHaveValue("230");
    await dialog.getByRole("button", { name: "Save Changes", exact: true }).click();
    await expect(dialog).toBeHidden();
    const [updated] = await db.select().from(orders).where(eq(orders.id, saved[0].id));
    expect(updated.quantityKg).toBe(130.125);
    expect(await db.select().from(binMovements).where(eq(binMovements.storageLocationId, seededData.productStorageLocation.id))).toEqual(before);
  } finally { await pool.end(); }
});
