/**
 * Facilities & Reactors E2E Tests
 *
 * Covers:
 * - UI CRUD: create a facility through the side sheet form, verify it appears in the list
 * - UI CRUD: create a reactor selecting the facility via EntitySelect, verify it appears in the list
 * - DB-level duplicate code enforcement (preserved from original test suite)
 */
import { test, expect } from "./fixtures";
import {
  createTestFacility,
  deleteTestFacility,
  type TestFacility,
} from "./fixtures";
import * as crypto from "crypto";

// ============================================
// Unique run identifier for this test file
// ============================================

const RUN_ID = crypto.randomUUID().slice(0, 8);

// ============================================
// Facility + Reactor UI CRUD
// ============================================

test.describe("Facility + Reactor UI CRUD", () => {
  test("admin can create a facility and it appears in the list", async ({
    adminPage,
    cleanupTestData,
  }) => {
    const page = adminPage;
    const facilityName = `UI Facility ${RUN_ID}`;
    const facilityCountry = "Kenya";

    // Navigate to facilities list
    await page.goto("/facilities");
    await expect(page).toHaveURL(/\/facilities/);

    // Open the create side sheet
    await page.getByRole("button", { name: /New Facility/i }).click();

    // Wait for the side sheet to be visible
    await page.waitForSelector('[role="dialog"]', { state: "visible" });

    // Fill in required fields
    await page.fill('input[name="name"]', facilityName);
    await page.fill('input[name="country"]', facilityCountry);

    // Submit the form
    await page.getByRole("button", { name: /Create Facility/i }).click();

    // Side sheet closes on success — wait for it to disappear
    await page.waitForSelector('[role="dialog"]', {
      state: "detached",
      timeout: 10000,
    });

    // Verify the new facility appears in the list
    await expect(page.getByText(facilityName)).toBeVisible();

    void cleanupTestData;
  });

  test("admin can create a reactor linked to a facility and it appears in the list", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    const page = adminPage;

    // seededData.facility was seeded into the DB and is available in EntitySelect
    const facilityId = seededData.facility.id;
    const reactorIdentifier = `UI Reactor ${RUN_ID}`;

    // Navigate to reactors list
    await page.goto("/reactors");
    await expect(page).toHaveURL(/\/reactors/);

    // Open the create side sheet
    await page.getByRole("button", { name: /New Reactor/i }).click();

    // Wait for the side sheet to be visible
    await page.waitForSelector('[role="dialog"]', { state: "visible" });

    // Fill in the identifier (required)
    await page.fill('input[name="identifier"]', reactorIdentifier);

    // Select the facility via EntitySelect
    await page.click('[data-testid="entity-select-trigger"]');
    await page.waitForSelector('[data-testid="entity-select-listbox"]', {
      state: "visible",
    });
    await page.click(`[data-testid="entity-option-${facilityId}"]`);

    // Select reactor type via native select
    await page.selectOption('select[name="reactorType"]', "fixed-bed");

    // Fill the "Type" text field (operational type, required)
    await page.fill('input[name="type"]', "primary pyrolysis");

    // Select sampling method (default is method_a, keep it)
    await page.selectOption('select[name="samplingMethod"]', "method_a");

    // Submit the form
    await page.getByRole("button", { name: /Create Reactor/i }).click();

    // Side sheet closes on success — wait for it to disappear
    await page.waitForSelector('[role="dialog"]', {
      state: "detached",
      timeout: 10000,
    });

    // Verify the new reactor appears in the list
    await expect(page.getByText(reactorIdentifier)).toBeVisible();

    void cleanupTestData;
  });
});

// ============================================
// DB-Level Duplicate Code Enforcement
// ============================================

test.describe("Facilities Duplicate Code Handling", () => {
  let existingFacility: TestFacility;

  test.beforeAll(async () => {
    existingFacility = await createTestFacility({
      code: `E2E-DUP-${RUN_ID}`,
      name: `Duplicate Test Facility ${RUN_ID}`,
      location: "Test Location",
    });
  });

  test.afterAll(async () => {
    if (existingFacility?.id) {
      await deleteTestFacility(existingFacility.id);
    }
  });

  test("facility code uniqueness is enforced at the database level", async () => {
    expect(existingFacility.code).toBe(`E2E-DUP-${RUN_ID}`);

    // Attempting to insert a duplicate code should throw
    await expect(
      createTestFacility({
        code: `E2E-DUP-${RUN_ID}`,
        name: "Duplicate Facility Attempt",
        location: "Duplicate Location",
      })
    ).rejects.toThrow();
  });
});
