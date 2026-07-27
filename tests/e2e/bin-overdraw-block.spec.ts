/**
 * Bin over-draw hard block (issue #116)
 *
 * Exercises all six guarded write paths through the UI. Feedstock draws use
 * dry mass (wet × (1 − moisture%/100)); product draws use formulation-scaled
 * biochar-equivalent mass; delivery draws use the product batch's own wet-mass
 * pool. Every path proves both the hard rejection and a legitimate save.
 */
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
  selectEntity,
  selectEntityByText,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";

const PRODUCTION_RUNS_URL = "/production-runs";
const BIOCHAR_PRODUCTS_URL = "/biochar-products";
const ORDERS_URL = "/orders";
const DELIVERIES_URL = "/deliveries";

const RUN_DATE = "2025-06-15";
const RUN_START_TIME = "08:00";
const RUN_END_TIME = "12:00";
const DELIVERY_DATE = "2027-06-16";

const BIOCHAR_BIN_STOCK_KG = "100";
const ORDER_QUANTITY_KG = "200000";
const feedstockOverdrawText = /not enough feedstock in this bin/i;
const biocharOverdrawText = /not enough biochar in this bin/i;
const deliveryOverdrawText =
  /cannot deliver .* only .* remain undelivered/i;
const ACTION_LABEL_PREFIX = "Actions for ";

async function getListedActionCodes(page: Page): Promise<Set<string>> {
  const table = page.getByRole("table", { name: "Production runs" });
  const emptyState = page.getByText(/No production runs (?:yet|found)/, {
    exact: true,
  });
  await expect
    .poll(async () => {
      if (await table.count()) return table.getAttribute("aria-busy");
      return (await emptyState.count()) ? "false" : "pending";
    })
    .toBe("false");
  const labels = await page
    .locator(`tbody button[aria-label^="${ACTION_LABEL_PREFIX}"]`)
    .evaluateAll(
      (buttons, prefixLength) =>
        buttons
          .map((button) => button.getAttribute("aria-label"))
          .filter((label): label is string => label !== null)
          .map((label) => label.slice(prefixLength)),
      ACTION_LABEL_PREFIX.length,
    );
  return new Set(labels);
}

async function getCreatedActionCode(
  page: Page,
  existingCodes: Set<string>,
): Promise<string> {
  let createdCodes: string[] = [];
  await expect
    .poll(async () => {
      createdCodes = [...(await getListedActionCodes(page))].filter(
        (code) => !existingCodes.has(code),
      );
      return createdCodes.length;
    })
    .toBe(1);
  const createdCode = createdCodes[0];
  if (!createdCode) throw new Error("Created action code was not rendered");
  return createdCode;
}

/** Open the existing draft run form against the seeded 100 kg-dry source bin. */
async function openRunFormWithSource(
  page: Page,
  seededData: SeededChainData,
  draw: { wetMassKg: string; moisturePercent: string },
) {
  await page.goto(
    `${PRODUCTION_RUNS_URL}?facility=${seededData.facility.id}`,
  );
  await expect(
    page.getByRole("button", { name: "New Production Run" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New Production Run" }).click();
  await waitForSideSheet(page);

  await page.selectOption('select[name="status"]', "draft");
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
  await page.fill('input[name="feedstockWetMassKg"]', draw.wetMassKg);
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
  },
) {
  await page.goto(
    `${PRODUCTION_RUNS_URL}?facility=${seededData.facility.id}`,
  );
  await expect(
    page.getByRole("button", { name: "New Production Run" }),
  ).toBeVisible();
  const existingRunCodes = await getListedActionCodes(page);
  await page.getByRole("button", { name: "New Production Run" }).click();
  await waitForSideSheet(page);

  await page.selectOption('select[name="status"]', "running");
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
    'input[name="feedstockWetMassKg"]',
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
  return existingRunCodes;
}

/** Submit the create-production-run side sheet. */
async function submitRunCreate(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Create Production Run")')
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
  await page.selectOption('select[name="status"]', "complete");
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

/** Open the first list row through its overflow-menu Edit action. */
async function editFirstRow(page: Page, readyInputName: string) {
  await expect(async () => {
    await page
      .locator("tbody tr")
      .first()
      .getByRole("button", { name: /Actions for/ })
      .click({ timeout: 5000 });
    await page
      .getByRole("menuitem", { name: "Edit" })
      .click({ timeout: 5000 });
  }).toPass({ timeout: 30000 });
  await waitForSideSheet(page);
  await expect(
    page.locator(
      `[role="dialog"] input[name="${readyInputName}"]`,
    ),
  ).toBeVisible();
}

/** Save an edit from any entity side sheet using the shared CTA label. */
async function saveEdit(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Save Changes")')
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
  runCode: string,
  massKg: string,
) {
  await page.goto(
    `${BIOCHAR_PRODUCTS_URL}?facility=${seededData.facility.id}`,
  );
  await expect(page.getByRole("button", { name: "New Product" })).toBeVisible();
  await page.getByRole("button", { name: "New Product" }).click();
  await waitForSideSheet(page);

  await selectEntityByText(page, "Production Run", runCode);
  await expect(page.locator('input[name="massKg"]')).toHaveValue(
    BIOCHAR_BIN_STOCK_KG,
  );
  await selectEntity(
    page,
    "Formulation",
    seededData.formulation.id,
    seededData.formulation.name,
  );
  await selectEntity(page, "Product Bin", productBin.id, productBin.name);

  await page.fill('input[name="massKg"]', massKg);
  await page.fill('input[name="moistureContentPercent"]', "0");
  await page.fill('input[name="waterAddedKg"]', "0");
}

/** Submit the create-biochar-product side sheet. */
async function submitProductCreate(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Create Product")')
    .click();
}

/** Create a linked formulation product against a 100 kg-output run. */
async function createLinkedProduct(
  page: Page,
  seededData: SeededChainData,
  productBin: TestStorageLocation,
  runCode: string,
  massKg: string,
) {
  await openLinkedProductForm(
    page,
    seededData,
    productBin,
    runCode,
    massKg,
  );
  await submitProductCreate(page);
  await waitForSideSheetClose(page);
}

/** Delete the UI-created product so its directly-seeded product bin can follow. */
async function deleteCreatedProduct(
  page: Page,
  seededData: SeededChainData,
  productBin: TestStorageLocation,
) {
  await page.goto(
    `${BIOCHAR_PRODUCTS_URL}?facility=${seededData.facility.id}`,
  );
  const actionButton = page
    .locator("tbody tr")
    .filter({ hasText: productBin.name })
    .getByRole("button", { name: /Actions for/ });
  await expect(actionButton).toBeVisible({ timeout: 10000 });
  await actionButton.click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirmDialog = page
    .getByRole("dialog")
    .filter({ hasText: "Delete Biochar Product" });
  await expect(confirmDialog).toBeVisible();
  await confirmDialog
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(confirmDialog).toBeHidden();
}

/** Remove product setup in FK order before the seeded fixture tears down. */
async function cleanupProductScenario(
  page: Page,
  seededData: SeededChainData,
  productBin: TestStorageLocation,
  productCreated: boolean,
) {
  if (productCreated) {
    await deleteCreatedProduct(page, seededData, productBin);
  }
  await deleteTestStorageLocation(productBin.id);
}

/** Create an order large enough that only product stock limits the delivery. */
async function createOrder(page: Page, seededData: SeededChainData) {
  await page.goto(`${ORDERS_URL}?facility=${seededData.facility.id}`);
  await expect(
    page.locator("aside").getByText(seededData.facility.name, { exact: false }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "New Order" }).click();
  await waitForSideSheet(page);

  await page.fill('input[name="orderDate"]', DELIVERY_DATE);
  await page.selectOption(
    'select[name="customerId"]',
    seededData.customer.id,
  );
  await page.waitForSelector(
    'select[name="customerLocationId"]:not([disabled])',
    { timeout: 8000 },
  );
  await page.selectOption(
    'select[name="customerLocationId"]',
    seededData.customerLocation.id,
  );
  await page.selectOption('select[name="packaging"]', "loose");
  await page.fill('input[name="quantityKg"]', ORDER_QUANTITY_KG);
  await selectEntity(
    page,
    "Biochar Product",
    seededData.biocharProduct.id,
    seededData.biocharProduct.code,
  );
  await page.getByRole("button", { name: "Create Order" }).click();
  await waitForSideSheetClose(page);
}

/** Open a delivered-status delivery form against the seeded product's order. */
async function openDeliveredDeliveryForm(
  page: Page,
  seededData: SeededChainData,
  wetMassKg: string,
) {
  await page.goto(`${DELIVERIES_URL}?facility=${seededData.facility.id}`);
  const newDeliveryButton = page
    .locator("header")
    .getByRole("button", { name: "New Delivery" });
  await expect(newDeliveryButton).toBeVisible();
  await newDeliveryButton.click();
  await waitForSideSheet(page);

  await page.fill('input[name="deliveryDate"]', DELIVERY_DATE);
  await page.selectOption('select[name="status"]', "delivered");
  await selectEntityByText(page, "Order", seededData.customer.name);
  await page.fill('input[name="deliveredWetMassKg"]', wetMassKg);
}

/** Submit the create-delivery side sheet. */
async function submitDeliveryCreate(page: Page) {
  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Create Delivery")')
    .click();
}

/** Create a delivered delivery after creating its product-backed order. */
async function createDeliveredDelivery(
  page: Page,
  seededData: SeededChainData,
  wetMassKg: string,
) {
  await createOrder(page, seededData);
  await openDeliveredDeliveryForm(page, seededData, wetMassKg);
  await submitDeliveryCreate(page);
  await waitForSideSheetClose(page);
}

/** Path 1: createProductionRun feedstock draw from 100 kg dry on hand. */
test.describe("createProductionRun feedstock guard", () => {
  test("rejects a feedstock draw exceeding the bin's on-hand stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // 200 wet @ 10% moisture = 180 kg dry, exceeding the 100 kg-dry bin.
    await openRunFormWithSource(page, seededData, {
      wetMassKg: "200",
      moisturePercent: "10",
    });

    const error = page.locator("#feedstockWetMassKg-error");
    await expect(error).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.locator('input[name="feedstockWetMassKg"]'),
    ).toHaveAttribute("aria-describedby", /feedstockWetMassKg-error/);
    await expect(error).toContainText(/available/i);

    // Correcting the draw must clear the inline error without a submit.
    await page.fill('input[name="feedstockWetMassKg"]', "50");
    await expect(error).toBeHidden();

    // Re-entering the overdraw still blocks the write.
    await page.fill('input[name="feedstockWetMassKg"]', "200");
    await submitRunCreate(page);
    await expect(error).toBeVisible({ timeout: 10000 });
  });

  test("accepts a feedstock draw within the bin's on-hand stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // 50 wet @ 10% moisture = 45 kg dry, within the 100 kg-dry bin.
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
    // The run owns 80 kg; replacing it with 110 kg still exceeds total stock.
    const runCode = await createCompleteRun(page, seededData, {
      feedstockWetMassKg: "80",
      feedstockMoisturePercent: "0",
    });
    await editRunByCode(page, runCode, "feedstockWetMassKg");
    await page.fill('input[name="feedstockWetMassKg"]', "110");
    await saveEdit(page);

    const error = page
      .locator('[role="dialog"]')
      .getByText(feedstockOverdrawText);
    await expect(error).toBeVisible({
      timeout: 10000,
    });
    await expect(error).toContainText(/available/i);
  });

  test("accepts an increased draw when the run's old draw is excluded", async ({
    adminPage: page,
    seededData,
  }) => {
    // 80 → 90 kg is valid against 100 kg total, but 80 + 90 would falsely fail.
    const runCode = await createCompleteRun(page, seededData, {
      feedstockWetMassKg: "80",
      feedstockMoisturePercent: "0",
    });
    await editRunByCode(page, runCode, "feedstockWetMassKg");
    await page.fill('input[name="feedstockWetMassKg"]', "90");
    await saveEdit(page);

    await waitForSideSheetClose(page);
  });
});

/** Path 3: createBiocharProduct scales wet mass by formulation ratio 0.7. */
test.describe("createBiocharProduct biochar-bin guard", () => {
  test("rejects a formulation-scaled draw exceeding biochar stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // A 150 kg product × 0.7 = 105 kg biochar from a 100 kg-output run.
    const productBin = await createProductBin(seededData);
    try {
      const runCode = await createCompleteRun(page, seededData, {
        biocharOutputKg: BIOCHAR_BIN_STOCK_KG,
      });
      await openLinkedProductForm(
        page,
        seededData,
        productBin,
        runCode,
        "150",
      );

      const error = page.locator("#massKg-error");
      await expect(error).toBeVisible({ timeout: 10000 });
      await expect(error).toContainText(/available/i);

      await page.fill('input[name="massKg"]', "140");
      await expect(error).toBeHidden();

      await page.fill('input[name="massKg"]', "150");
      await submitProductCreate(page);
      await expect(error).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupProductScenario(page, seededData, productBin, false);
    }
  });

  test("accepts a formulation-scaled draw within biochar stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // A 140 kg product × 0.7 = 98 kg, within the run's 100 kg output.
    const productBin = await createProductBin(seededData);
    let productCreated = false;
    try {
      const runCode = await createCompleteRun(page, seededData, {
        biocharOutputKg: BIOCHAR_BIN_STOCK_KG,
      });
      await openLinkedProductForm(
        page,
        seededData,
        productBin,
        runCode,
        "140",
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

/** Path 4: updateBiocharProduct excludes its own prior scaled allocation. */
test.describe("updateBiocharProduct biochar-bin guard", () => {
  test("rejects an edited scaled draw exceeding total biochar stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // Initial draw is 70 kg; replacing it with 105 kg still exceeds 100 kg.
    const productBin = await createProductBin(seededData);
    let productCreated = false;
    try {
      const runCode = await createCompleteRun(page, seededData, {
        biocharOutputKg: BIOCHAR_BIN_STOCK_KG,
      });
      await createLinkedProduct(
        page,
        seededData,
        productBin,
        runCode,
        "100",
      );
      productCreated = true;
      await editRowByText(page, productBin.name, "massKg");
      await page.fill('input[name="massKg"]', "150");
      await saveEdit(page);

      const error = page
        .locator('[role="dialog"]')
        .getByText(biocharOverdrawText);
      await expect(error).toBeVisible({ timeout: 10000 });
      await expect(error).toContainText(/available/i);
    } finally {
      await cleanupProductScenario(
        page,
        seededData,
        productBin,
        productCreated,
      );
    }
  });

  test("accepts an increased scaled draw when the product is excluded", async ({
    adminPage: page,
    seededData,
  }) => {
    // 70 → 98 kg is valid, but counting old + replacement gives a false 168 kg.
    const productBin = await createProductBin(seededData);
    let productCreated = false;
    try {
      const runCode = await createCompleteRun(page, seededData, {
        biocharOutputKg: BIOCHAR_BIN_STOCK_KG,
      });
      await createLinkedProduct(
        page,
        seededData,
        productBin,
        runCode,
        "100",
      );
      productCreated = true;
      await editRowByText(page, productBin.name, "massKg");
      await page.fill('input[name="massKg"]', "140");
      await saveEdit(page);
      await waitForSideSheetClose(page);
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

/** Path 5: createDelivery draws delivered wet mass from its product batch. */
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
    await submitDeliveryCreate(page);
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

/** Path 6: updateDelivery excludes its own prior delivered mass. */
test.describe("updateDelivery product-batch guard", () => {
  test("rejects an edited delivery exceeding total product stock", async ({
    adminPage: page,
    seededData,
  }) => {
    // The delivery owns 80,000 kg; replacing it with 100,001 kg is still invalid.
    await createDeliveredDelivery(page, seededData, "80000");
    await editFirstRow(page, "deliveredWetMassKg");
    await page.fill('input[name="deliveredWetMassKg"]', "100001");
    await saveEdit(page);

    await expect(
      page.locator('[role="dialog"]').getByText(deliveryOverdrawText),
    ).toBeVisible({ timeout: 10000 });
  });

  test("accepts an increased delivery when its old draw is excluded", async ({
    adminPage: page,
    seededData,
  }) => {
    // 80,000 → 90,000 kg is valid; old + replacement would falsely be 170,000.
    await createDeliveredDelivery(page, seededData, "80000");
    await editFirstRow(page, "deliveredWetMassKg");
    await page.fill('input[name="deliveredWetMassKg"]', "90000");
    await saveEdit(page);

    await waitForSideSheetClose(page);
  });
});
