/**
 * Product Bin ↔ Formulation E2E
 *
 * Verifies the "clean product bins" rule in the Biochar Product create form:
 *   - Selecting a formulation filters the Product Bin dropdown to bins reserved
 *     for that formulation PLUS unassigned (empty) bins; bins reserved for a
 *     different formulation are hidden.
 *   - Leaving the formulation empty (pure-biochar product) shows only
 *     unassigned / pure bins; formulation-reserved bins are hidden.
 *
 * Exercises the real stack: form → entity-select query → storage-location
 * data-access filter. Prerequisite bins/formulations are seeded directly via DB
 * helpers; the assertions run against the live UI.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import {
  generateTestId,
  createTestFacility,
  createTestFormulation,
  createTestStorageLocation,
  deleteTestFacility,
  deleteTestFormulation,
  deleteTestStorageLocation,
  type TestFacility,
  type TestFormulation,
  type TestStorageLocation,
} from "./fixtures";
import { selectEntity, waitForSideSheet } from "./fixtures/page-helpers";

test.describe("Product bin ↔ formulation filtering", () => {
  let facility: TestFacility;
  let formulationA: TestFormulation;
  let formulationB: TestFormulation;
  let binA: TestStorageLocation; // reserved for formulation A
  let binB: TestStorageLocation; // reserved for formulation B
  let binEmpty: TestStorageLocation; // unassigned (pure / claim-on-first-use)

  test.beforeAll(async () => {
    const id = generateTestId("pbf");
    const tag = id.toUpperCase();

    facility = await createTestFacility({
      code: `E2E-PBF-FAC-${tag}`,
      name: `PBF Facility ${id}`,
    });
    formulationA = await createTestFormulation({
      code: `E2E-PBF-A-${tag}`,
      name: `PBF Blend A ${id}`,
      biocharRatio: 0.6,
    });
    formulationB = await createTestFormulation({
      code: `E2E-PBF-B-${tag}`,
      name: `PBF Blend B ${id}`,
      biocharRatio: 0.4,
    });
    binA = await createTestStorageLocation(facility.id, {
      code: `E2E-PBF-BINA-${tag}`,
      name: `PBF Bin A ${id}`,
      type: "product_bin",
      formulationId: formulationA.id,
    });
    binB = await createTestStorageLocation(facility.id, {
      code: `E2E-PBF-BINB-${tag}`,
      name: `PBF Bin B ${id}`,
      type: "product_bin",
      formulationId: formulationB.id,
    });
    binEmpty = await createTestStorageLocation(facility.id, {
      code: `E2E-PBF-BINE-${tag}`,
      name: `PBF Bin Empty ${id}`,
      type: "product_bin",
      formulationId: null,
    });
  });

  test.afterAll(async () => {
    // Bins reference the facility; remove them before the facility. Formulations
    // are referenced by the bins (app-layer, no FK) so order is not strict, but
    // keep a sensible teardown order anyway.
    await deleteTestStorageLocation(binA.id).catch(() => {});
    await deleteTestStorageLocation(binB.id).catch(() => {});
    await deleteTestStorageLocation(binEmpty.id).catch(() => {});
    await deleteTestFormulation(formulationA.id).catch(() => {});
    await deleteTestFormulation(formulationB.id).catch(() => {});
    await deleteTestFacility(facility.id).catch(() => {});
  });

  async function openCreateForm(page: Page) {
    await page.goto(`/biochar-products?facility=${facility.id}`);
    await page.waitForLoadState("networkidle");
    await page.click('button:has-text("New Product")');
    await waitForSideSheet(page);
  }

  /** Open the Product Bin EntitySelect dropdown (scoped to the dialog). */
  async function openProductBinDropdown(page: Page) {
    const dialog = page.locator('[role="dialog"]');
    const label = dialog.locator("label").filter({ hasText: "Product Bin" }).first();
    const fieldContainer = label.locator("..");
    await fieldContainer.locator('[data-testid="entity-select-trigger"]').click();
    await page.waitForSelector('[data-testid="entity-select-listbox"]', { timeout: 10000 });
  }

  test("selecting a formulation shows its bins + empty bins, hides other formulations' bins", async ({
    adminPage: page,
  }) => {
    await openCreateForm(page);

    // Formulation drives the bin filter.
    await selectEntity(page, "Formulation", formulationA.id, formulationA.name);

    await openProductBinDropdown(page);

    // Assert a present option first so the query has resolved before we assert
    // an absence (avoids a transient empty-list false positive).
    await expect(page.locator(`[data-testid="entity-option-${binA.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="entity-option-${binEmpty.id}"]`)).toBeVisible();
    // Bin reserved for a different formulation must NOT appear.
    await expect(page.locator(`[data-testid="entity-option-${binB.id}"]`)).toHaveCount(0);
  });

  test("no formulation (pure biochar) shows only unassigned bins", async ({
    adminPage: page,
  }) => {
    await openCreateForm(page);

    // Leave the formulation empty → pure-biochar path.
    await openProductBinDropdown(page);

    await expect(page.locator(`[data-testid="entity-option-${binEmpty.id}"]`)).toBeVisible();
    // Formulation-reserved bins must NOT appear for a pure-biochar product.
    await expect(page.locator(`[data-testid="entity-option-${binA.id}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="entity-option-${binB.id}"]`)).toHaveCount(0);
  });
});
