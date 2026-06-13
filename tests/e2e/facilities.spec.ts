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
import type { Locator } from "@playwright/test";
import { dismissCertifierLinkDialog } from "./fixtures/page-helpers";
import * as crypto from "crypto";

// ============================================
// Unique run identifier for this test file
// ============================================

const RUN_ID = crypto.randomUUID().slice(0, 8);
const VIEWPORT_EDGE_TOLERANCE_PX = 1;

async function expectDialogInsideViewport(
  dialog: Locator,
  viewport: { width: number } | null,
) {
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(
    viewport!.width + VIEWPORT_EDGE_TOLERANCE_PX,
  );
}

// ============================================
// Facility + Reactor UI CRUD
// ============================================

test.describe("Facility + Reactor UI CRUD", () => {
  test("admin can create a facility, switch context, and create a reactor under it", async ({
    adminPage,
    cleanupTestData,
  }) => {
    const page = adminPage;
    const facilityName = `UI Facility ${RUN_ID}`;
    const facilityCountry = "Kenya";
    const reactorIdentifier = `Context Reactor ${RUN_ID}`;

    // Navigate to facilities list
    await page.goto("/facilities");
    await expect(page).toHaveURL(/\/facilities/);
    await expect(page.getByText("Active Facilities")).toBeVisible({
      timeout: 15000,
    });

    // Open the create side sheet
    await page.getByRole("button", { name: /New Facility/i }).click();

    // Wait for the side sheet to be visible
    await page.waitForSelector('[role="dialog"]', { state: "visible" });
    const facilityDialog = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("button", { name: /Create Facility/i }) });
    await expect(facilityDialog).toBeVisible();

    await expectDialogInsideViewport(facilityDialog, page.viewportSize());

    await facilityDialog.getByRole("button", { name: /Cancel/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: /New Facility/i }).click();
    await expect(facilityDialog).toBeVisible();
    await expectDialogInsideViewport(facilityDialog, page.viewportSize());

    // Fill in required fields
    await page.fill('input[name="name"]', facilityName);
    await page.fill('input[name="country"]', facilityCountry);
    await page.selectOption('select[name="timezone"]', "Africa/Nairobi");

    // Submit the form
    await page.getByRole("button", { name: /Create Facility/i }).click();

    // Side sheet closes on success. A separate optional certifier dialog may open.
    await facilityDialog.waitFor({ state: "hidden", timeout: 10000 });

    // Admins get an optional "Link Isometric project" prompt after create
    // (facility-list.tsx); it aria-hides the page, so dismiss it before
    // asserting on the list.
    await dismissCertifierLinkDialog(page);

    // Search for the new facility (list may be paginated with many entries)
    const searchBox = page.getByRole("textbox", { name: "Search facilities" });
    await searchBox.fill(facilityName);
    await page.waitForTimeout(500); // debounce

    // Verify the new facility appears in the filtered card results.
    await expect(
      page.getByRole("heading", { name: facilityName, exact: true })
    ).toBeVisible({ timeout: 10000 });

    const activeFacilityId = new URL(page.url()).searchParams.get("facility");
    expect(activeFacilityId).toBeTruthy();
    await expect(
      page
        .locator('button[aria-haspopup="listbox"]')
        .filter({ hasText: facilityName })
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("link", { name: /^Reactors$/i }).click();
    await expect(page).toHaveURL((url) => {
      return (
        url.pathname === "/reactors" &&
        url.searchParams.get("facility") === activeFacilityId
      );
    });

    await page.getByRole("button", { name: /New Reactor/i }).click();
    await page.waitForSelector('[role="dialog"]', { state: "visible" });
    await page.fill('input[name="identifier"]', reactorIdentifier);
    await page.selectOption('select[name="reactorType"]', "fixed-bed");
    await page.selectOption('select[name="samplingMethod"]', "method_a");
    await page.fill('input[name="capacityTph"]', "500");
    await page.getByRole("button", { name: /Create Reactor/i }).click();
    await page.waitForSelector('[role="dialog"]', {
      state: "detached",
      timeout: 10000,
    });

    const reactorSearchBox = page.getByPlaceholder(/search/i);
    await reactorSearchBox.click();
    await reactorSearchBox.fill(reactorIdentifier);
    await page.waitForTimeout(1500);

    await expect(
      page.getByRole("button", { name: reactorIdentifier }).first()
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.locator("table tbody tr").filter({ hasText: reactorIdentifier })
    ).toContainText(facilityName);

    void cleanupTestData;
  });

  test("admin can create a reactor linked to a facility and it appears in the list", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    const page = adminPage;

    // seededData.facility was seeded into the DB and is available in EntitySelect
    const reactorIdentifier = `UI Reactor ${RUN_ID}`;

    // Navigate to reactors list
    await page.goto(`/reactors?facility=${seededData.facility.id}`);
    await expect(page).toHaveURL(/\/reactors/);
    await page.waitForLoadState("networkidle");

    // Open the create side sheet
    await page.getByRole("button", { name: /New Reactor/i }).click();

    // Wait for the side sheet to be visible
    await page.waitForSelector('[role="dialog"]', { state: "visible" });

    // Fill in the identifier (required)
    await page.fill('input[name="identifier"]', reactorIdentifier);

    // Select reactor type via native select
    await page.selectOption('select[name="reactorType"]', "fixed-bed");

    // Select sampling method (default is method_a, keep it)
    await page.selectOption('select[name="samplingMethod"]', "method_a");
    await page.fill('input[name="capacityTph"]', "500");

    // Submit the form
    await page.getByRole("button", { name: /Create Reactor/i }).click();

    // Side sheet closes on success — wait for it to disappear
    await page.waitForSelector('[role="dialog"]', {
      state: "detached",
      timeout: 10000,
    });

    // Wait for the list to reload after mutation
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);

    // Search for the new reactor (list may be paginated with many entries)
    const searchBox = page.getByPlaceholder(/search/i);
    await searchBox.click();
    await searchBox.fill(reactorIdentifier);
    // Wait for debounce + server round-trip
    await page.waitForTimeout(1500);

    // Verify the new reactor appears in the filtered list.
    await expect(
      page.getByRole("button", { name: reactorIdentifier }).first()
    ).toBeVisible({ timeout: 10000 });

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
