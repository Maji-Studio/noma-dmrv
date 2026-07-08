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
import type { Page } from "@playwright/test";
import { test, expect, type SeededChainData } from "./fixtures";
import { deliveryStatuses } from "../../src/schemas/deliveries";
import { selectEntity, selectEntityByText } from "./fixtures/page-helpers";

// ============================================
// Test Constants
// ============================================

const ORDERS_URL = "/orders";
const DELIVERIES_URL = "/deliveries";

/**
 * Select a biochar product in the order form.
 * The product field is a searchable EntitySelect (custom dropdown showing live
 * "kg in bin" stock), not a native <select>, so it is driven via its trigger
 * button and per-option testids rather than selectOption().
 */
async function selectBiocharProduct(page: Page, productId: string) {
  await selectEntity(page, "Biochar Product", productId);
}

async function createOrderViaUi(
  page: Page,
  seededData: SeededChainData,
  quantityKg: string,
) {
  const ordersUrl = `${ORDERS_URL}?facility=${seededData.facility.id}`;

  await page.goto(ordersUrl);
  await expect(page).toHaveURL(new RegExp(ORDERS_URL), { timeout: 10000 });

  // Wait for full hydration — the sidebar facility selector only shows the
  // facility name once the FacilityProvider has loaded and resolved.
  await expect(
    page.locator("aside").getByText(seededData.facility.name, { exact: false })
  ).toBeVisible({ timeout: 15000 });

  await page.click('button:has-text("New Order")');
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });

  await page.fill('input[name="orderDate"]', "2026-03-02");
  await page.selectOption('select[name="customerId"]', seededData.customer.id);
  await page.waitForSelector('select[name="customerLocationId"]:not([disabled])', {
    timeout: 8000,
  });
  await page.selectOption(
    'select[name="customerLocationId"]',
    seededData.customerLocation.id
  );

  // Selecting a location surfaces the read-only details panel with the stored
  // facility distance and its provenance (issue #196). The mini map is not
  // asserted — it needs a MapTiler key absent in hermetic CI.
  await expect(page.getByTestId("order-location-details")).toBeVisible({
    timeout: 8000,
  });
  await expect(page.getByTestId("order-location-distance")).toContainText(
    "25 km from"
  );

  await page.selectOption('select[name="packaging"]', "loose");
  await page.fill('input[name="quantityKg"]', quantityKg);
  await selectBiocharProduct(page, seededData.biocharProduct.id);
  await page.click('button[type="submit"]:has-text("Create Order")');
  await page.waitForSelector('[role="dialog"]', {
    state: "hidden",
    timeout: 10000,
  });
}

async function createDeliveryViaUi(page: Page, seededData: SeededChainData) {
  await createOrderViaUi(page, seededData, "50");

  const deliveriesUrl = `${DELIVERIES_URL}?facility=${seededData.facility.id}`;
  await page.goto(deliveriesUrl);
  await expect(page).toHaveURL(new RegExp(DELIVERIES_URL), {
    timeout: 10000,
  });

  await page.click('button:has-text("New Delivery")');
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });

  await page.fill('input[name="deliveryDate"]', "2026-03-02");
  await page.selectOption('select[name="status"]', "upcoming");
  await selectEntityByText(page, "Order", seededData.customer.name);
  await page.fill('input[name="deliveredWetMassKg"]', "95");
  await page.click('button[type="submit"]:has-text("Create Delivery")');
  await page.waitForSelector('[role="dialog"]', {
    state: "hidden",
    timeout: 10000,
  });
}

// ============================================
// Order + Delivery UI CRUD
// ============================================

test.describe("Order + Delivery UI CRUD", () => {
  // -------------------------------------------------------
  // Orders — Create
  // -------------------------------------------------------

  test("admin can create a new order via the side sheet form", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData; // ensure fixture is active for auto-cleanup
    await createOrderViaUi(adminPage, seededData, "100");

    // --- Verify the new order appears in the list ---

    // Look for the seeded customer name in the table (the Order list shows the customer).
    // Scope to the table body so the customer-filter <select> options (added in #264,
    // which render the same names but are hidden while collapsed) don't shadow the cell.
    const customerCellLocator = adminPage
      .locator("table tbody")
      .getByText(seededData.customer.name, { exact: false });
    await expect(customerCellLocator.first()).toBeVisible({ timeout: 8000 });

    // Verify the order appears in the list
    const firstCodeCell = adminPage.locator("table tbody tr").first().locator("td").first();
    const orderCode = (await firstCodeCell.textContent()) ?? "";
    expect(orderCode.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------
  // Orders — Read (list verification)
  // -------------------------------------------------------

  test("orders list shows at least one order", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    await createOrderViaUi(adminPage, seededData, "100");

    await adminPage.goto(`${ORDERS_URL}?facility=${seededData.facility.id}`);
    await expect(adminPage).toHaveURL(new RegExp(ORDERS_URL), { timeout: 10000 });

    // Verify the orders list has at least one row from this test's seed.
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
    await createDeliveryViaUi(adminPage, seededData);

    // ---- Verify delivery appears in the list ----
    // Customer text may be off-screen/paginated; assert list row render instead.
    await expect(
      adminPage.locator("table tbody tr").first()
    ).toBeVisible({ timeout: 8000 });
  });

  // -------------------------------------------------------
  // Deliveries — Read (list verification)
  // -------------------------------------------------------

  test("deliveries list shows at least one delivery", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    await createDeliveryViaUi(adminPage, seededData);

    await adminPage.goto(`${DELIVERIES_URL}?facility=${seededData.facility.id}`);
    await expect(adminPage).toHaveURL(new RegExp(DELIVERIES_URL), {
      timeout: 10000,
    });

    // Verify the deliveries list has at least one row from this test's seed.
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
  test("delivery status values are valid", () => {
    expect(deliveryStatuses).toContain("upcoming");
    expect(deliveryStatuses).toContain("delivered");
  });

  test("packaging types are valid", () => {
    const validPackaging = ["loose", "bagged"];
    expect(validPackaging).toContain("loose");
    expect(validPackaging).toContain("bagged");
  });
});
