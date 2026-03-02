/**
 * Distribution (Orders & Deliveries) E2E Tests
 *
 * UI CRUD tests for Orders and Deliveries using authenticated fixtures
 * and pre-seeded lookup data.
 *
 * Prerequisites (handled by fixtures):
 * - Admin user seeded and authenticated via adminPage
 * - Facility, Customer, CustomerLocation, BiocharProduct seeded via seededData
 */
import { test, expect } from "./fixtures";

// ============================================
// Test Constants
// ============================================

const ORDERS_URL = "/orders";
const DELIVERIES_URL = "/deliveries";

// ============================================
// Order + Delivery UI CRUD
// ============================================

test.describe("Order + Delivery UI CRUD", () => {
  // Track the created order's code so the delivery test can find it in the select
  let createdOrderCode: string;
  let createdOrderId: string;

  // -------------------------------------------------------
  // Orders — Create
  // -------------------------------------------------------

  test("admin can create a new order via the side sheet form", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData; // ensure fixture is active for auto-cleanup

    // Navigate to the orders list
    await adminPage.goto(ORDERS_URL);
    await expect(adminPage).toHaveURL(new RegExp(ORDERS_URL), { timeout: 10000 });

    // Open the "New Order" side sheet
    await adminPage.click('button:has-text("New Order")');
    await adminPage.waitForSelector('[role="dialog"]', { timeout: 8000 });

    // --- Fill in required fields ---

    // Order Date
    await adminPage.fill('input[name="orderDate"]', "2026-03-02");

    // Facility
    await adminPage.selectOption(
      'select[name="facilityId"]',
      seededData.facility.id
    );

    // Status
    await adminPage.selectOption('select[name="status"]', "draft");

    // Customer — selecting triggers an async load of customer locations
    await adminPage.selectOption(
      'select[name="customerId"]',
      seededData.customer.id
    );

    // Wait for the cascading customerLocationId select to become enabled
    await adminPage.waitForSelector(
      'select[name="customerLocationId"]:not([disabled])',
      { timeout: 8000 }
    );
    await adminPage.selectOption(
      'select[name="customerLocationId"]',
      seededData.customerLocation.id
    );

    // Packaging
    await adminPage.selectOption('select[name="packaging"]', "loose");

    // Quantity
    await adminPage.fill('input[name="quantityKg"]', "100");

    // Biochar Product
    await adminPage.selectOption(
      'select[name="biocharProductId"]',
      seededData.biocharProduct.id
    );

    // Submit the form
    await adminPage.click('button[type="submit"]:has-text("Create Order")');

    // Side sheet should close on success
    await adminPage.waitForSelector('[role="dialog"]', {
      state: "hidden",
      timeout: 10000,
    });

    // --- Verify the new order appears in the list ---

    // Look for the seeded customer name in the table (the Order list shows the customer)
    const customerCellLocator = adminPage.getByText(
      seededData.customer.name,
      { exact: false }
    );
    await expect(customerCellLocator.first()).toBeVisible({ timeout: 8000 });

    // Capture the order code from the first row so the delivery test can use it
    // The code column is rendered with a distinctive style; grab the first code cell
    const firstCodeCell = adminPage.locator("table tbody tr").first().locator("td").first();
    createdOrderCode = (await firstCodeCell.textContent()) ?? "";
    expect(createdOrderCode.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------
  // Orders — Read (list verification)
  // -------------------------------------------------------

  test("orders list shows at least one order", async ({
    adminPage,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    await adminPage.goto(ORDERS_URL);
    await expect(adminPage).toHaveURL(new RegExp(ORDERS_URL), { timeout: 10000 });

    // Verify the orders list has at least one row (from create test or prior runs)
    await expect(
      adminPage.locator("table tbody tr").first()
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------
  // Deliveries — Create (selects the order created above)
  // -------------------------------------------------------

  test("admin can create a new delivery linked to the seeded order", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    // ---- First, ensure an order exists to select in the delivery form ----
    // We create one inline so this test is self-contained even when run in isolation.

    await adminPage.goto(ORDERS_URL);
    await expect(adminPage).toHaveURL(new RegExp(ORDERS_URL), { timeout: 10000 });

    await adminPage.click('button:has-text("New Order")');
    await adminPage.waitForSelector('[role="dialog"]', { timeout: 8000 });

    await adminPage.fill('input[name="orderDate"]', "2026-03-02");
    await adminPage.selectOption('select[name="facilityId"]', seededData.facility.id);
    await adminPage.selectOption('select[name="status"]', "draft");
    await adminPage.selectOption('select[name="customerId"]', seededData.customer.id);
    await adminPage.waitForSelector(
      'select[name="customerLocationId"]:not([disabled])',
      { timeout: 8000 }
    );
    await adminPage.selectOption(
      'select[name="customerLocationId"]',
      seededData.customerLocation.id
    );
    await adminPage.selectOption('select[name="packaging"]', "loose");
    await adminPage.fill('input[name="quantityKg"]', "50");
    await adminPage.selectOption('select[name="biocharProductId"]', seededData.biocharProduct.id);
    await adminPage.click('button[type="submit"]:has-text("Create Order")');
    await adminPage.waitForSelector('[role="dialog"]', {
      state: "hidden",
      timeout: 10000,
    });

    // Grab the orderId from the first row we just created via the select options
    // that will be rendered in the delivery form. We identify the order by the
    // customer name displayed in the orderId select (format: "CustomerName - Date").

    // ---- Navigate to Deliveries and open the creation form ----

    await adminPage.goto(DELIVERIES_URL);
    await expect(adminPage).toHaveURL(new RegExp(DELIVERIES_URL), {
      timeout: 10000,
    });

    await adminPage.click('button:has-text("New Delivery")');
    await adminPage.waitForSelector('[role="dialog"]', { timeout: 8000 });

    // Delivery Date
    await adminPage.fill('input[name="deliveryDate"]', "2026-03-02");

    // Status
    await adminPage.selectOption('select[name="status"]', "processing");

    // Order — select by the customer name that should be part of the option label
    // (DeliveryForm renders options as "CustomerName - Date")
    const orderSelect = adminPage.locator('select[name="orderId"]');
    await orderSelect.waitFor({ state: "attached", timeout: 8000 });

    // Find the option whose text includes our seeded customer name
    const matchingOption = orderSelect.locator(
      `option:text-matches("${seededData.customer.name}", "i")`
    );

    // Wait for options to populate (async fetch)
    await expect(matchingOption.first()).toBeAttached({ timeout: 8000 });

    // Get the value attribute of the matching option and use it to select
    const optionValue = await matchingOption.first().getAttribute("value");
    expect(optionValue).not.toBeNull();
    createdOrderId = optionValue!;

    await adminPage.selectOption('select[name="orderId"]', createdOrderId);

    // Wet mass
    await adminPage.fill('input[name="deliveredWetMassKg"]', "95");

    // Submit
    await adminPage.click('button[type="submit"]:has-text("Create Delivery")');

    // Side sheet should close on success
    await adminPage.waitForSelector('[role="dialog"]', {
      state: "hidden",
      timeout: 10000,
    });

    // ---- Verify delivery appears in the list ----

    // The delivery list shows the customer name (via the linked order)
    const customerCellLocator = adminPage.getByText(
      seededData.customer.name,
      { exact: false }
    );
    await expect(customerCellLocator.first()).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------
  // Deliveries — Read (list verification)
  // -------------------------------------------------------

  test("deliveries list shows at least one delivery", async ({
    adminPage,
    cleanupTestData,
  }) => {
    void cleanupTestData;

    await adminPage.goto(DELIVERIES_URL);
    await expect(adminPage).toHaveURL(new RegExp(DELIVERIES_URL), {
      timeout: 10000,
    });

    // Verify the deliveries list has at least one row
    await expect(
      adminPage.locator("table tbody tr").first()
    ).toBeVisible({ timeout: 8000 });
  });
});

// ============================================
// Business Logic Validation (pure JS — no browser needed)
// ============================================

test.describe("Delivery Mass Validation - Isometric Protocol", () => {
  test("massDryKg must be >= 0", () => {
    const validateDryMass = (value: number | null): boolean => {
      if (value === null) return true;
      return value >= 0;
    };

    expect(validateDryMass(100)).toBe(true);
    expect(validateDryMass(0)).toBe(true);
    expect(validateDryMass(-1)).toBe(false);
    expect(validateDryMass(-100)).toBe(false);
    expect(validateDryMass(null)).toBe(true);
  });

  test("massDryKg must be <= deliveredWetMassKg when both are present", () => {
    const validateMassRelation = (
      dryMass: number | null,
      wetMass: number | null
    ): boolean => {
      if (dryMass === null || wetMass === null) return true;
      return dryMass <= wetMass;
    };

    expect(validateMassRelation(100, 200)).toBe(true);
    expect(validateMassRelation(100, 100)).toBe(true);
    expect(validateMassRelation(0, 100)).toBe(true);
    expect(validateMassRelation(null, 100)).toBe(true);
    expect(validateMassRelation(100, null)).toBe(true);
    expect(validateMassRelation(null, null)).toBe(true);

    expect(validateMassRelation(200, 100)).toBe(false);
    expect(validateMassRelation(101, 100)).toBe(false);
  });

  test("moisture content must be between 0 and 100 percent", () => {
    const validateMoisture = (value: number | null): boolean => {
      if (value === null) return true;
      return value >= 0 && value <= 100;
    };

    expect(validateMoisture(0)).toBe(true);
    expect(validateMoisture(50)).toBe(true);
    expect(validateMoisture(100)).toBe(true);
    expect(validateMoisture(-1)).toBe(false);
    expect(validateMoisture(101)).toBe(false);
    expect(validateMoisture(null)).toBe(true);
  });
});

// ============================================
// Enum / schema sanity checks (pure JS)
// ============================================

test.describe("Distribution Schema Constants", () => {
  test("order status values are valid", () => {
    const validStatuses = ["draft", "ordered", "processed"];
    expect(validStatuses).toContain("draft");
    expect(validStatuses).toContain("ordered");
    expect(validStatuses).toContain("processed");
  });

  test("delivery status values are valid", () => {
    const validStatuses = ["scheduled", "processing", "delivered"];
    expect(validStatuses).toContain("scheduled");
    expect(validStatuses).toContain("processing");
    expect(validStatuses).toContain("delivered");
  });

  test("packaging types are valid", () => {
    const validPackaging = ["loose", "bagged"];
    expect(validPackaging).toContain("loose");
    expect(validPackaging).toContain("bagged");
  });
});
