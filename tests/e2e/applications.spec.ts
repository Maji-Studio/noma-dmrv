/**
 * Application + Credit Batch UI CRUD Tests
 *
 * Tests creating applications and credit batches through the browser UI.
 * Depends on deliveries existing in the system (created by distribution tests or seeded).
 *
 * Chain: Delivery → Application → Credit Batch
 */
import { test, expect } from "./fixtures";
import { waitForSideSheet, waitForSideSheetClose } from "./fixtures/page-helpers";

test.describe("Application + Credit Batch UI CRUD", () => {
  test("create application via UI form", async ({
    adminPage: page,
    seededData,
  }) => {
    // First, we need a delivery to exist. Create an order and delivery first.
    // Step 1: Create an order
    await page.goto("/orders");
    await page.waitForLoadState("networkidle");
    await page.click('button:has-text("New Order")');
    await waitForSideSheet(page);

    const today = new Date().toISOString().split("T")[0];
    await page.fill('input[name="orderDate"]', today);
    await page.selectOption('select[name="facilityId"]', seededData.facility.id);
    await page.selectOption('select[name="status"]', "draft");
    await page.selectOption('select[name="customerId"]', seededData.customer.id);

    // Wait for customer locations to load (cascading from customer selection)
    await page.waitForTimeout(1000);
    await page.selectOption(
      'select[name="customerLocationId"]',
      seededData.customerLocation.id
    );

    await page.selectOption(
      'select[name="biocharProductId"]',
      seededData.biocharProduct.id
    );
    await page.selectOption('select[name="packaging"]', "loose");
    await page.fill('input[name="quantityKg"]', "100");

    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('button:has-text("Create Order")').click();
    await waitForSideSheetClose(page);

    // Step 2: Create a delivery for this order
    await page.goto("/deliveries");
    await page.waitForLoadState("networkidle");
    await page.click('button:has-text("New Delivery")');
    await waitForSideSheet(page);

    await page.fill('input[name="deliveryDate"]', today);
    // Select the first available order
    await page.selectOption('select[name="status"]', "processing");
    // The orderId select should have our order — select the first option
    const orderSelect = page.locator('select[name="orderId"]');
    const orderOptions = orderSelect.locator("option:not([value=''])");
    const firstOrderValue = await orderOptions.first().getAttribute("value");
    if (firstOrderValue) {
      await orderSelect.selectOption(firstOrderValue);
    }
    await page.fill('input[name="deliveredWetMassKg"]', "95");

    await page.locator('[role="dialog"]').locator('button:has-text("Create Delivery")').click();
    await waitForSideSheetClose(page);

    // Step 3: Create an application
    await page.goto("/applications");
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
    await page.fill('input[name="biocharAppliedTons"]', "5");
    await page.fill('input[name="biocharAppliedDryTons"]', "4.5");
    await page.fill('input[name="fieldSizeHa"]', "2");
    await page.fill('input[name="fieldIdentifier"]', "E2E-Field-01");
    await page.fill('input[name="cropType"]', "maize");

    await page.locator('[role="dialog"]').locator('button:has-text("Create Application")').click();
    await waitForSideSheetClose(page);

    // Verify application appears in list
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("table tbody tr, [role='row']").first()
    ).toBeVisible({ timeout: 10000 });
  });

  test("create credit batch via UI form", async ({
    adminPage: page,
    seededData,
  }) => {
    await page.goto("/credit-batches");
    await page.waitForLoadState("networkidle");

    await page.click('button:has-text("New Credit Batch")');
    await waitForSideSheet(page);

    const today = new Date().toISOString().split("T")[0];

    // Fill Overview section
    await page.selectOption(
      'select[name="facilityId"]',
      seededData.facility.id
    );
    await page.fill('input[name="startDate"]', today);
    await page.fill('input[name="endDate"]', today);
    await page.selectOption('select[name="status"]', "draft");

    // Select applications (checkbox toggle)
    // The application checkboxes should be visible - click the first one if available
    const appCheckboxes = page.locator('input[type="checkbox"]');
    const checkboxCount = await appCheckboxes.count();
    if (checkboxCount > 0) {
      // Click the label/container for the first application to toggle it
      const firstAppLabel = page
        .locator("label")
        .filter({ has: page.locator('input[type="checkbox"]') })
        .first();
      await firstAppLabel.click();
    }

    // Durability section (defaults to 200_year)
    await page.selectOption('select[name="durabilityOption"]', "200_year");
    // H:Corg ratio is required for 200-year durability (conditionally rendered)
    await page.waitForSelector('input[name="hToCorgRatio"]', { timeout: 5000 });
    await page.fill('input[name="hToCorgRatio"]', "0.4");

    // Submit
    await page.locator('[role="dialog"]').locator('button:has-text("Create Credit Batch")').click();
    await waitForSideSheetClose(page);

    // Verify credit batch appears in list
    await page.waitForLoadState("networkidle");
    await expect(
      page.locator("table tbody tr, [role='row']").first()
    ).toBeVisible({ timeout: 10000 });
  });
});
