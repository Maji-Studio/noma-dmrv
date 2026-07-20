/**
 * Application + Credit Batch UI CRUD Tests
 *
 * Tests creating applications and credit batches through the browser UI.
 * Depends on deliveries existing in the system (created by distribution tests or seeded).
 *
 * Chain: Delivery → Application → Credit Batch
 */
import type { Page } from "@playwright/test";
import { test, expect, type SeededChainData } from "./fixtures";
import {
  selectEntity,
  selectFirstCreditBatchProductionRun,
  selectFirstEntity,
  waitForSideSheet,
  waitForSideSheetClose,
} from "./fixtures/page-helpers";

async function createProductionRunForCreditBatch(
  page: Page,
  seededData: SeededChainData,
  date: string,
) {
  await page.goto(`/production-runs?facility=${seededData.facility.id}`);
  await page.waitForLoadState("networkidle");

  await page.click('button:has-text("New Production Run")');
  await waitForSideSheet(page);

  await page.selectOption('select[name="status"]', "running");
  await selectEntity(
    page,
    "Reactor",
    seededData.reactor.id,
    seededData.reactor.identifier,
  );
  await page.fill('input[name="startDate"]', date);
  await page.fill('input[name="startTime"]', "08:00");
  await selectEntity(
    page,
    "Source Bin",
    seededData.feedstockStorageLocation.id,
    seededData.feedstockStorageLocation.name,
  );
  await page.fill('input[name="feedstockWetMassKg"]', "50");
  await page.fill('input[name="feedstockMoisturePercent"]', "15");
  await selectEntity(
    page,
    "Biochar Storage",
    seededData.biocharStorageLocation.id,
    seededData.biocharStorageLocation.name,
  );
  await page.fill('input[name="biocharOutputKg"]', "10");

  await page
    .locator('[role="dialog"]')
    .locator('button:has-text("Create Production Run")')
    .click();
  await waitForSideSheetClose(page);

  await page
    .locator("tbody tr")
    .first()
    .getByRole("button", { name: /Actions for/ })
    .click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await waitForSideSheet(page);
  await page.fill('input[name="endDate"]', date);
  await page.fill('input[name="endTime"]', "12:00");
  await page.selectOption('select[name="status"]', "complete");
  await page
    .locator('[role="dialog"]')
    .getByRole("button", { name: "Save Changes" })
    .click();
  await waitForSideSheetClose(page);
}

test.describe("Application + Credit Batch UI CRUD", () => {
  test("create application via UI form", async ({
    adminPage: page,
    seededData,
  }) => {
    const ordersUrl = `/orders?facility=${seededData.facility.id}`;
    const deliveriesUrl = `/deliveries?facility=${seededData.facility.id}`;
    const applicationsUrl = `/applications?facility=${seededData.facility.id}`;

    // First, we need a delivery to exist. Create an order and delivery first.
    // Step 1: Create an order
    await page.goto(ordersUrl);
    await page.waitForLoadState("networkidle");
    await page.click('button:has-text("New Order")');
    await waitForSideSheet(page);

    const today = new Date().toISOString().split("T")[0];
    await page.fill('input[name="orderDate"]', today);
    await page.selectOption('select[name="customerId"]', seededData.customer.id);

    // Wait for customer locations to load (cascading from customer selection)
    await page.waitForSelector(
      'select[name="customerLocationId"]:not([disabled])',
      { timeout: 8000 }
    );
    await page.selectOption(
      'select[name="customerLocationId"]',
      seededData.customerLocation.id
    );

    await selectEntity(
      page,
      "Biochar Product",
      seededData.biocharProduct.id,
      seededData.biocharProduct.code
    );
    await page.selectOption('select[name="packaging"]', "loose");
    await page.fill('input[name="quantityKg"]', "100");

    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("Create Order")').click();
    await waitForSideSheetClose(page);

    // Step 2: Create a delivery for this order
    await page.goto(deliveriesUrl);
    await page.waitForLoadState("networkidle");
    await page.click('button:has-text("New Delivery")');
    await waitForSideSheet(page);

    await page.fill('input[name="deliveryDate"]', today);
    // Applications require a delivered delivery (issue #284)
    await page.selectOption('select[name="status"]', "delivered");
    // The order picker is a FormEntitySelect (custom dropdown) — pick the first option
    await selectFirstEntity(page, "Order");
    await page.fill('input[name="deliveredWetMassKg"]', "10000");

    await page.locator('[role="dialog"]').locator('button:has-text("Create Delivery")').click();
    await waitForSideSheetClose(page);

    // Step 3: Create an application
    await page.goto(applicationsUrl);
    await page.waitForLoadState("networkidle");

    await page.click('button:has-text("New Application")');
    await waitForSideSheet(page);

    await page.fill('input[name="applicationDate"]', today);

    // Select the first available delivery
    const deliverySelect = page.locator('select[name="deliveryId"]');
    const deliveryOptions = deliverySelect.locator("option:not([value=''])");
    const firstDeliveryValue = await deliveryOptions
      .first()
      .getAttribute("value");
    if (firstDeliveryValue) {
      await deliverySelect.selectOption(firstDeliveryValue);
    }

    // Fill required and optional fields
    await page.fill('input[name="biocharAppliedTons"]', "5000");
    await page.fill('input[name="biocharAppliedDryTons"]', "4500");
    await page.fill('input[name="fieldSizeHa"]', "2");
    await page.fill('input[name="fieldIdentifier"]', "E2E-Field-01");
    await page.fill('input[name="cropType"]', "maize");

    await expect(
      page.locator('input[name="evidenceMethod"][value="visual"]')
    ).toBeChecked();
    await expect(page.locator('input[name="gisBoundaryReference"]')).toHaveCount(0);

    // Scope to the side-sheet form: #264's list evidence-method <select> renders the
    // same labels, so an unscoped getByText matches two elements (strict-mode violation).
    await page
      .locator('[role="dialog"]')
      .getByText("Boundary records", { exact: true })
      .click();
    await expect(
      page.locator('input[name="evidenceMethod"][value="boundary"]')
    ).toBeChecked();
    await expect(page.locator('input[name="gisBoundaryReference"]')).toBeVisible();
    await page.fill(
      'input[name="gisBoundaryReference"]',
      "https://maps.example.test/e2e-field-01",
    );

    await page
      .locator('[role="dialog"]')
      .getByText("Visual proof", { exact: true })
      .click();
    await expect(
      page.locator('input[name="evidenceMethod"][value="visual"]')
    ).toBeChecked();
    await expect(page.locator('input[name="gisBoundaryReference"]')).toHaveCount(0);

    await page.locator('[role="dialog"]').locator('button:has-text("Create Application")').click();
    await waitForSideSheetClose(page);

    // Verify application appears in list
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("table tbody tr, [role='row']").first()
    ).toBeVisible({ timeout: 10000 });

    const applicationRow = page.locator("table tbody tr[role='button']").first();
    await applicationRow.focus();
    await page.keyboard.press("Enter");
    await waitForSideSheet(page);
    await page.getByRole("button", { name: "Edit Application" }).click();
    // The visual-evidence panel renders one image upload slot per evidence role
    // (APPLICATION_VISUAL_EVIDENCE_ROLES), so target the first; the no-geotag
    // check is role-independent.
    const evidenceUpload = page
      .locator('[role="dialog"] input[type="file"][accept="image/*"]')
      .first();
    await evidenceUpload.setInputFiles({
      name: "application-no-exif.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
        0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb,
        0x00, 0x43, 0x00, 0xff, 0xd9,
      ]),
    });
    const uploadedEvidence = page.locator('[role="dialog"] li', {
      hasText: "application-no-exif.jpg",
    });
    await expect(uploadedEvidence.first()).toBeVisible({
      timeout: 10000,
    });
    await expect(uploadedEvidence.first()).toContainText("No geotag:", {
      timeout: 10000,
    });
  });

  test("blocks application against an undelivered delivery", async ({
    adminPage: page,
    seededData,
  }) => {
    const today = new Date().toISOString().split("T")[0];

    // Step 1: Create an order
    await page.goto(`/orders?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");
    await page.click('button:has-text("New Order")');
    await waitForSideSheet(page);

    await page.fill('input[name="orderDate"]', today);
    await page.selectOption('select[name="customerId"]', seededData.customer.id);
    await page.waitForSelector(
      'select[name="customerLocationId"]:not([disabled])',
      { timeout: 8000 }
    );
    await page.selectOption(
      'select[name="customerLocationId"]',
      seededData.customerLocation.id
    );
    await selectEntity(
      page,
      "Biochar Product",
      seededData.biocharProduct.id,
      seededData.biocharProduct.code
    );
    await page.selectOption('select[name="packaging"]', "loose");
    await page.fill('input[name="quantityKg"]', "100");

    await page.locator('[role="dialog"]').locator('button:has-text("Create Order")').click();
    await waitForSideSheetClose(page);

    // Step 2: Create a delivery left in "upcoming" status
    await page.goto(`/deliveries?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");
    await page.click('button:has-text("New Delivery")');
    await waitForSideSheet(page);

    await page.fill('input[name="deliveryDate"]', today);
    await page.selectOption('select[name="status"]', "upcoming");
    await selectFirstEntity(page, "Order");
    await page.fill('input[name="deliveredWetMassKg"]', "10000");

    await page.locator('[role="dialog"]').locator('button:has-text("Create Delivery")').click();
    await waitForSideSheetClose(page);

    // Step 3: The application form lists the undelivered delivery but
    // disables it (issue #284 custody-ordering guard)
    await page.goto(`/applications?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");
    await page.click('button:has-text("New Application")');
    await waitForSideSheet(page);

    const undeliveredOption = page.locator(
      'select[name="deliveryId"] option:has-text("not yet delivered")'
    );
    await expect(undeliveredOption.first()).toBeAttached({ timeout: 8000 });
    await expect(undeliveredOption.first()).toBeDisabled();
  });

  test("create credit batch via UI form", async ({
    adminPage: page,
    seededData,
  }) => {
    const today = new Date().toISOString().split("T")[0];
    await createProductionRunForCreditBatch(page, seededData, today);

    await page.goto(`/credit-batches?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    await page.click('button:has-text("New Credit Batch")');
    await waitForSideSheet(page);

    // Fill Overview section
    await page.fill('input[name="startDate"]', today);
    await page.fill('input[name="endDate"]', today);

    await selectFirstCreditBatchProductionRun(page, seededData.feedstockType);

    // Durability is snapshotted from the facility default and rendered read-only.

    // Submit
    await page.locator('[role="dialog"]').locator('button:has-text("Create Credit Batch")').click();
    await waitForSideSheetClose(page);

    // Verify credit batch appears in list
    await page.waitForLoadState("networkidle");
    await expect(page.locator("article").first()).toBeVisible({ timeout: 10000 });
  });
});
