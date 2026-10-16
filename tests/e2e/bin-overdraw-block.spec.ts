/**
 * Bin over-draw hard block (issue #116)
 *
 * Exercises all six guarded write paths through the UI. Feedstock draws use
 * the bin's wet/as-received stock; output draws conserve measured dry biochar
 * and fixed ingredient solids. Posted delivery changes use journal corrections. Every path proves both the hard rejection and a legitimate save.
 */
import { deleteProductBinFixtures } from "./helpers/product-source-fixture";
import type { Page } from "@playwright/test";
import {
  createTestStorageLocation,
  deleteTestStorageLocation,
  test,
  expect,
  type SeededChainData,
  type TestStorageLocation,
} from "./fixtures";
import {
  ACTION_LABEL_PREFIX,
  getCreatedActionCode,
  getListedActionCodes,
  selectEntity,
  selectEntityByText,
  waitForFacilityHydration,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";
import { fillStockMoisture } from "./helpers/stock-moisture";
import { FIFO_BROWSER_TIME, seedOutputStockBrowserFixture } from "./helpers/output-stock-browser-fixture";
import { chooseRunStatus } from "./helpers/run-status";

const PRODUCTION_RUNS_URL = "/production-runs";
const BIOCHAR_PRODUCTS_URL = "/biochar-products";
const ORDERS_URL = "/orders";
const DELIVERIES_URL = "/deliveries";

const RUN_DATE = "2025-06-15";
const RUN_START_TIME = "08:00";
const RUN_END_TIME = "12:00";
// After RUN_DATE and in the past: delivery corrections refuse future times (decision 56).
const DELIVERY_DATE = "2025-06-16";

const BIOCHAR_BIN_STOCK_KG = "100";
const ORDER_QUANTITY_KG = "200000";
const FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR =
  'input[name="feedstockDraws.0.wetMassKg"]';
const feedstockOverdrawText =
  /^Only .+ of wet feedstock is available\. Reduce the wet mass\.$/;
const biocharOverdrawText = /Not enough dry biochar in the selected bin/;

/** Open a new run form against the seeded 120 kg-wet source bin. */
async function openRunFormWithSource(
  page: Page,
  seededData: SeededChainData,
  draw: { wetMassKg: string; moisturePercent: string },
) {
  await page.goto(
    `${PRODUCTION_RUNS_URL}?facility=${seededData.facility.id}`,
  );
  await waitForFacilityHydration(page, seededData.facility.name);
  await expect(
    page.getByRole("button", { name: "New production run" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New production run" }).click();
  await waitForSideSheet(page);

  await chooseRunStatus(page, "running");
  await selectEntity(
    page,
    "Reactor",
    seededData.reactor.id,
    seededData.reactor.identifier,
  );
  await page.fill('input[name="startDate"]', RUN_DATE);
  await selectEntity(
    page,
    "Source Bin",
    seededData.feedstockStorageLocation.id,
    seededData.feedstockStorageLocation.name,
  );
  await page.fill(FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR, draw.wetMassKg);
  await page.fill(
    'input[name="feedstockMoisturePercent"]',
    draw.moisturePercent,
  );
}

/** Open a running run form that can draw feedstock and/or seed biochar stock. */
async function openCompleteRunForm(
  page: Page,
  seededData: SeededChainData,
  values: {
    feedstockWetMassKg?: string;
    feedstockMoisturePercent?: string;
    biocharOutputKg?: string;
    biocharMoisturePercent?: string;
  },
) {
  await page.goto(
    `${PRODUCTION_RUNS_URL}?facility=${seededData.facility.id}`,
  );
  await waitForFacilityHydration(page, seededData.facility.name);
  await expect(
    page.getByRole("button", { name: "New production run" }),
  ).toBeVisible();
  const existingRunCodes = await getListedActionCodes(page);
  await page.getByRole("button", { name: "New production run" }).click();
  await waitForSideSheet(page);

  await chooseRunStatus(page, "running");
  await selectEntity(
    page,
    "Reactor",
    seededData.reactor.id,
    seededData.reactor.identifier,
  );
  await page.fill('input[name="startDate"]', RUN_DATE);
  await page.fill('input[name="startTime"]', RUN_START_TIME);
  await selectEntity(
    page,
    "Source Bin",
    seededData.feedstockStorageLocation.id,
    seededData.feedstockStorageLocation.name,
  );
  await page.fill(
    FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR,
    values.feedstockWetMassKg ?? "1",
  );
  await page.fill(
    'input[name="feedstockMoisturePercent"]',
    values.feedstockMoisturePercent ?? "0",
  );

  await selectEntity(
    page,
    "Biochar Storage",
    seededData.biocharStorageLocation.id,
    seededData.biocharStorageLocation.name,
  );
  await page.fill(
    'input[name="biocharOutputKg"]',
    values.biocharOutputKg ?? "1",
  );
  await page.fill(
    'input[name="biocharMoisturePercent"]',
    values.biocharMoisturePercent ?? "0",
  );
  return existingRunCodes;
}

/** Submit the create-production-run side sheet. */
async function submitRunCreate(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Create production run")')
    .click();
}

/** Create and persist a complete run with the requested stock inputs/outputs. */
async function createCompleteRun(
  page: Page,
  seededData: SeededChainData,
  values: Parameters<typeof openCompleteRunForm>[2],
) {
  const existingRunCodes = await openCompleteRunForm(page, seededData, values);
  await submitRunCreate(page);
  await waitForSideSheetClose(page);
  const runCode = await getCreatedActionCode(page, existingRunCodes);

  await editRunByCode(page, runCode, "endTime");
  await page.fill('input[name="endDate"]', RUN_DATE);
  await page.fill('input[name="endTime"]', RUN_END_TIME);
  await chooseRunStatus(page, "complete");
  await saveEdit(page);
  await waitForSideSheetClose(page);
  return runCode;
}

/** Open a specific production run through its stable run-code action label. */
async function editRunByCode(
  page: Page,
  runCode: string,
  readyInputName: string,
) {
  const actionName = `${ACTION_LABEL_PREFIX}${runCode}`;
  await expect(
    page.locator("tbody").getByRole("button", {
      name: actionName,
      exact: true,
    }),
  ).toBeVisible({ timeout: 10000 });
  await expect(async () => {
    await page
      .locator("tbody")
      .getByRole("button", { name: actionName, exact: true })
      .click({ timeout: 5000 });
    await page
      .getByRole("menuitem", { name: "Edit" })
      .click({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await waitForSideSheet(page);
  await expect(
    page.locator(`[role="dialog"] input[name="${readyInputName}"]`),
  ).toBeVisible();
}

/** Open the row containing unique entity text through its Edit action. */
async function editRowByText(
  page: Page,
  uniqueText: string,
  readyInputName: string,
) {
  const matchingRow = page.locator("tbody tr").filter({ hasText: uniqueText });
  await expect(matchingRow).toHaveCount(1, { timeout: 10000 });
  await expect(async () => {
    await matchingRow
      .getByRole("button", { name: /Actions for/ })
      .click({ timeout: 5000 });
    await page
      .getByRole("menuitem", { name: "Edit" })
      .click({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await waitForSideSheet(page);
  await expect(
    page.locator(`[role="dialog"] input[name="${readyInputName}"]`),
  ).toBeVisible();
}

/** Save an edit from any entity side sheet using the shared CTA label. */
async function saveEdit(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Save changes")')
    .click();
}

/** Seed the missing formulation product-bin prerequisite for a product scenario. */
async function createProductBin(
  seededData: SeededChainData,
): Promise<TestStorageLocation> {
  return createTestStorageLocation(seededData.facility.id, {
    type: "product_bin",
    formulationId: seededData.formulation.id,
  });
}

/** Open a linked-product form and select its scoped formulation product bin. */
async function openLinkedProductForm(
  page: Page,
  seededData: SeededChainData,
  productBin: TestStorageLocation,
  massKg: string,
) {
  await page.goto(
    `${BIOCHAR_PRODUCTS_URL}?facility=${seededData.facility.id}`,
  );
  await waitForFacilityHydration(page, seededData.facility.name);
  await expect(page.getByRole("button", { name: "New product" })).toBeVisible();
  await page.getByRole("button", { name: "New product" }).click();
  await waitForSideSheet(page);

  await selectEntity(
    page,
    "Biochar bin",
    seededData.biocharStorageLocation.id,
    seededData.biocharStorageLocation.name,
  );
  await selectEntity(
    page,
    "Formulation",
    seededData.formulation.id,
    seededData.formulation.name,
  );
  await selectEntity(page, "Product bin", productBin.id, productBin.name);

  await page.fill('input[name="massKg"]', massKg);
  await fillStockMoisture(page, "product-source", "0");
  await page.fill('input[name="waterAddedKg"]', "0");
}

/** Submit the create-biochar-product side sheet. */
async function submitProductCreate(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Create product")')
    .click();
}

/** Create a linked formulation product against a 100 kg-output run. */
async function createLinkedProduct(
  page: Page,
  seededData: SeededChainData,
  productBin: TestStorageLocation,
  massKg: string,
) {
  await openLinkedProductForm(
    page,
    seededData,
    productBin,
    massKg,
  );
  await submitProductCreate(page);
  await waitForSideSheetClose(page);
}

/** Remove product setup in FK order before the seeded fixture tears down. */
async function cleanupProductScenario(
  page: Page,
  seededData: SeededChainData,
  productBin: TestStorageLocation,
  productCreated: boolean,
) {
  if (productCreated) {
    await deleteProductBinFixtures(productBin.id);
  }
  await deleteTestStorageLocation(productBin.id);
}

/** Create an order large enough that only product stock limits the delivery. */
async function createOrder(page: Page, seededData: SeededChainData, quantityKg = ORDER_QUANTITY_KG) {
  await page.goto(`${ORDERS_URL}?facility=${seededData.facility.id}`);
  await waitForFacilityHydration(page, seededData.facility.name);
  await page.getByRole("button", { name: "New order" }).click();
  await waitForSideSheet(page);

  await page.fill('input[name="orderDate"]', DELIVERY_DATE);
  await selectEntity(
    page,
    "Customer",
    seededData.customer.id,
    seededData.customer.name,
  );
  await selectEntity(page, "Customer location", seededData.customerLocation.id, seededData.customerLocation.name);
  await page.selectOption('select[name="packaging"]', "loose");
  await page.fill('input[name="quantityKg"]', quantityKg);
  await selectEntity(
    page,
    "Formulation", seededData.formulation.id, seededData.formulation.name,
  );
  await page.getByRole("button", { name: "Create order" }).click();
  await waitForSideSheetClose(page);
}

/** Open a delivered-status delivery form against the seeded product's order. */
async function openDeliveredDeliveryForm(
  page: Page,
  seededData: SeededChainData,
  wetMassKg: string,
) {
  await page.goto(`${DELIVERIES_URL}?facility=${seededData.facility.id}`);
  await waitForFacilityHydration(page, seededData.facility.name);
  const newDeliveryButton = page
    .locator("header")
    .getByRole("button", { name: "New delivery" });
  await expect(newDeliveryButton).toBeVisible();
  await newDeliveryButton.click();
  await waitForSideSheet(page);

  await page.fill('input[name="deliveryDate"]', `${DELIVERY_DATE}T12:00`);
  await selectEntityByText(page, "Order", seededData.customer.name);
  await selectEntity(page, "Actual source bin", seededData.productStorageLocation.id, seededData.productStorageLocation.name);
  await page.fill('input[name="deliveredWetMassKg"]', wetMassKg);
  await fillStockMoisture(page, "delivery", "10");
}

/** Submit the create-delivery side sheet. */
async function submitDeliveryCreate(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Create delivery")')
    .click();
}

/** Path 1: createProductionRun feedstock draw from 120 kg wet on hand. */
test.describe("createProductionRun feedstock guard", () => {
  test("rejects a feedstock draw exceeding the bin's on-hand stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // 200 kg wet exceeds the bin's authoritative 120 kg wet balance.
    await openRunFormWithSource(page, seededData, {
      wetMassKg: "200",
      moisturePercent: "10",
    });

    const error = page.locator("#feedstockDraws\\.0\\.wetMassKg-error");
    await expect(error).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator(FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR),
    ).toHaveAttribute(
      "aria-describedby",
      /feedstockDraws\.0\.wetMassKg-error/,
    );
    await expect(error).toHaveText(feedstockOverdrawText);

    // Correcting the draw must clear the inline error without a submit.
    await page.fill(FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR, "50");
    await expect(error).toBeHidden();

    // Re-entering the overdraw still blocks the write.
    await page.fill(FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR, "200");
    await submitRunCreate(page);
    await expect(error).toBeVisible({ timeout: 10000 });
  });

  test("accepts a feedstock draw within the bin's on-hand stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // 50 kg wet is within the bin's authoritative 120 kg wet balance.
    await openRunFormWithSource(page, seededData, {
      wetMassKg: "50",
      moisturePercent: "10",
    });
    await submitRunCreate(page);

    await waitForSideSheetClose(page);
    await expect(page.locator("table tbody tr").first()).toBeVisible({
      timeout: 10000,
    });
  });
});

/** Path 2: updateProductionRun excludes the edited run's own prior allocation. */
test.describe("updateProductionRun feedstock guard", () => {
  test("rejects an edited draw exceeding total feedstock stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // The run owns 80 kg; replacing it with 130 kg exceeds total wet stock.
    const runCode = await createCompleteRun(page, seededData, {
      feedstockWetMassKg: "80",
      feedstockMoisturePercent: "0",
    });
    await editRunByCode(page, runCode, "feedstockDraws.0.wetMassKg");
    await page.fill(FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR, "130");

    const error = page
      .locator('[role="dialog"]')
      .getByText(feedstockOverdrawText);
    await expect(error).toBeVisible({ timeout: 10000 });
    await saveEdit(page);

    await expect(error).toBeVisible({
      timeout: 10000,
    });
    await expect(error).toHaveText(feedstockOverdrawText);
  });

  test("accepts an increased draw when the run's old draw is excluded", async ({
    adminPage: page,
    seededData,
  }) => {
    // 80 → 90 kg is valid against 120 kg total, but 80 + 90 would falsely fail.
    const runCode = await createCompleteRun(page, seededData, {
      feedstockWetMassKg: "80",
      feedstockMoisturePercent: "0",
    });
    await editRunByCode(page, runCode, "feedstockDraws.0.wetMassKg");
    await page.fill(FIRST_FEEDSTOCK_DRAW_WET_MASS_SELECTOR, "90");
    await saveEdit(page);

    await waitForSideSheetClose(page);
  });
});

/** Path 3: createBiocharProduct subtracts the recorded ingredient draw. */
test.describe("createBiocharProduct biochar-bin guard", () => {
  test("rejects a recorded source draw exceeding biochar stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // This formulation has no ingredient lines, so 101 kg requires 101 kg from
    // the 100 kg-output run and must be rejected.
    const productBin = await createProductBin(seededData);
    try {
      await createCompleteRun(page, seededData, {
        feedstockWetMassKg: BIOCHAR_BIN_STOCK_KG,
        biocharOutputKg: BIOCHAR_BIN_STOCK_KG,
      });
      await openLinkedProductForm(
        page,
        seededData,
        productBin,
        "101",
      );

      const error = page.locator("#massKg-error");
      await expect(error).toBeVisible({ timeout: 10000 });
      await expect(error).toHaveText(biocharOverdrawText);

      await page.fill('input[name="massKg"]', "100");
      await expect(error).toBeHidden();

      await page.fill('input[name="massKg"]', "101");
      await expect(page.getByRole("button", { name: "Create product", exact: true })).toBeDisabled();
      await expect(error).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupProductScenario(page, seededData, productBin, false);
    }
  });

  test("accepts a recorded source draw within biochar stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // This formulation has no ingredient lines, so 100 kg draws exactly the
    // 100 kg available from the run.
    const productBin = await createProductBin(seededData);
    let productCreated = false;
    try {
      await createCompleteRun(page, seededData, {
        feedstockWetMassKg: BIOCHAR_BIN_STOCK_KG,
        biocharOutputKg: BIOCHAR_BIN_STOCK_KG,
      });
      await openLinkedProductForm(
        page,
        seededData,
        productBin,
        "100",
      );
      await submitProductCreate(page);
      await waitForSideSheetClose(page);
      productCreated = true;
    } finally {
      await cleanupProductScenario(
        page,
        seededData,
        productBin,
        productCreated,
      );
    }
  });
});

/** Path 4: posted source measurements cannot be rewritten through ordinary edit. */
test.describe("updateBiocharProduct source allocation", () => {
  test("blocks ordinary moisture edits on a posted source allocation", async ({
    adminPage: page,
    seededData,
  }) => {
    const productBin = await createProductBin(seededData);
    let productCreated = false;
    try {
      await createCompleteRun(page, seededData, {
        feedstockWetMassKg: BIOCHAR_BIN_STOCK_KG,
        biocharOutputKg: BIOCHAR_BIN_STOCK_KG,
      });
      await createLinkedProduct(
        page,
        seededData,
        productBin,
        "100",
      );
      productCreated = true;
      await editRowByText(
        page,
        productBin.name,
        "moistureContentPercent",
      );
      const dialog = page.locator('[role="dialog"]');
      await expect(
        dialog.locator('input[name="massKg"]'),
      ).toBeDisabled();
      const moistureInput = dialog.locator(
        'input[name="moistureContentPercent"]',
      );
      await expect(moistureInput).toBeEnabled();
      await moistureInput.fill("5");
      await saveEdit(page);
      await expect(dialog.getByRole("alert").filter({ hasText: "Posted product source, composition, placement, and bin are immutable" })).toBeVisible();
    } finally {
      await cleanupProductScenario(
        page,
        seededData,
        productBin,
        productCreated,
      );
    }
  });
});

/** Path 5: 90,000 kg dry supports 100,000 kg wet at 10% departure moisture. */
test.describe("createDelivery product-batch guard", () => {
  test("rejects a delivered mass exceeding the product batch", async ({
    adminPage: page,
    seededData,
  }) => {
    // The seeded batch holds 100,000 kg; 100,001 kg cannot be delivered.
    await createOrder(page, seededData);
    await openDeliveredDeliveryForm(page, seededData, "100001");

    const error = page.locator("#deliveredWetMassKg-error");
    await expect(error).toBeVisible({ timeout: 10000 });

    await page.fill('input[name="deliveredWetMassKg"]', "90000");
    await expect(error).toBeHidden();

    await page.fill('input[name="deliveredWetMassKg"]', "100001");
    await expect(page.getByRole("button", { name: "Create delivery", exact: true })).toBeDisabled();
    await expect(error).toBeVisible({ timeout: 10000 });
  });

  test("accepts a delivered mass within the product batch", async ({
    adminPage: page,
    seededData,
  }) => {
    // 90,000 kg is within the seeded product's 100,000 kg wet-mass pool.
    await createOrder(page, seededData);
    await openDeliveredDeliveryForm(page, seededData, "90000");
    await submitDeliveryCreate(page);

    await waitForSideSheetClose(page);
  });
});

/** A completed load must fit the order as well as the source bin. */
test.describe("createDelivery order-balance guard", () => {
  test("blocks order over-allocation and accepts a corrected mass", async ({ adminPage: page, seededData }) => {
    await createOrder(page, seededData, "100");
    await openDeliveredDeliveryForm(page, seededData, "101");
    await submitDeliveryCreate(page);
    await expect(page.locator("#deliveredWetMassKg-error")).toContainText("Only 100 kg remains on this order");
    await expect(page.locator('[role="alert"]:not(#deliveredWetMassKg-error)').filter({ hasText: /order/i })).toHaveCount(0);
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    await page.fill('input[name="deliveredWetMassKg"]', "100");
    await submitDeliveryCreate(page);
    await waitForSideSheetClose(page);
  });
});

/** Delivery measurements can be corrected until a later draw depends on them. */
test("edits delivery mass, links its saved source and locks it after a dependent draw", async ({ adminPage: page, testUsers }) => {
  const f = await seedOutputStockBrowserFixture(testUsers.admin.id, true);
  const created = f.delivery!;
  await page.goto(`/deliveries?facility=${f.facility.id}&delivery=${created.id}`);
  await waitForFacilityHydration(page, f.facility.name);
  await page.getByRole("button", { name: "Edit delivery", exact: true }).click();
  const wet = page.locator('input[name="deliveredWetMassKg"]');
  await expect(wet).toBeEnabled();
  await expect(page.locator('input[name="deliveryDate"]')).toBeDisabled();
  await wet.fill("1900");
  await fillStockMoisture(page, "delivery", "30");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const openBin = async () => {
    await page.goto(`/storage-locations?facility=${f.facility.id}`);
    await waitForFacilityHydration(page, f.facility.name);
    await page.getByPlaceholder("Search by code or name…").fill(f.bin.code);
    await page.getByText(f.bin.name, { exact: true }).first().click();
  };
  await openBin();
  await page.getByRole("button", { name: "History", exact: true }).click();
  const history = page.getByRole("dialog", { name: "Stock history", exact: true });
  const corrected = history.locator("details").filter({ hasText: "Correction" }).first();
  await corrected.locator("summary").click();
  await expect(corrected).toContainText("Original");
  await expect(corrected).toContainText("Corrected");
  const link = corrected.getByRole("link", { name: "Open delivery" });
  await expect(link).toHaveAttribute("href", `/deliveries?facility=${f.facility.id}&delivery=${created.id}`);
  await link.click();
  await expect(page.getByRole("dialog")).toContainText(created.code);

  await openBin();
  await page.getByRole("button", { name: "Adjust stock", exact: true }).click();
  await page.locator("#occurredAt").fill(FIFO_BROWSER_TIME);
  await page.locator("#stock-wet").fill("10");
  await fillStockMoisture(page, "stock", "30");
  await page.locator("#stock-reason").fill("E2E newer stock entry");
  await page.getByRole("button", { name: "Save lost mass", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(`/deliveries?facility=${f.facility.id}&delivery=${created.id}`);
  await waitForFacilityHydration(page, f.facility.name);
  await page.getByRole("button", { name: "Edit delivery", exact: true }).click();
  await expect(wet).toBeDisabled();
  await expect(page.locator('input[name="moistureContentPercent"]')).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText("Correction blocked by a later lost mass:");
});
