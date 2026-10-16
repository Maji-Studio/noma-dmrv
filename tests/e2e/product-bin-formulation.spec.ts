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
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { createDbConnection } from "./fixtures/db";
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
    if (binA) await deleteTestStorageLocation(binA.id).catch(() => {});
    if (binB) await deleteTestStorageLocation(binB.id).catch(() => {});
    if (binEmpty) await deleteTestStorageLocation(binEmpty.id).catch(() => {});
    if (formulationA) await deleteTestFormulation(formulationA.id).catch(() => {});
    if (formulationB) await deleteTestFormulation(formulationB.id).catch(() => {});
    if (facility) await deleteTestFacility(facility.id).catch(() => {});
  });

  async function openCreateForm(page: Page) {
    await page.goto(`/biochar-products?facility=${facility.id}`);
    await page.waitForLoadState("networkidle");
    await page.click('button:has-text("New product")');
    await waitForSideSheet(page);
  }

  /** Open the Product Bin EntitySelect dropdown (scoped to the dialog). */
  async function openProductBinDropdown(page: Page) {
    const dialog = page.locator('[role="dialog"]');
    const label = dialog.locator("label").filter({ hasText: "Product Bin" }).first();
    const fieldContainer = label.locator(
      "xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]"
    );
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

  test("an archived formulation is hidden from the formulation picker", async ({
    adminPage: page,
  }) => {
    const id = generateTestId("pbf-arch");
    const archived = await createTestFormulation({
      code: `E2E-PBF-ARCH-${id.toUpperCase()}`,
      name: `PBF Archived ${id}`,
      biocharRatio: 0.5,
    });
    const { db, pool } = createDbConnection();
    try {
      await db
        .update(schema.formulations)
        .set({ archivedAt: new Date() })
        .where(eq(schema.formulations.id, archived.id));
    } finally {
      await pool.end();
    }

    try {
      await openCreateForm(page);
      const dialog = page.locator('[role="dialog"]');
      const label = dialog.locator("label").filter({ hasText: "Formulation" }).first();
      const field = label.locator(
        "xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]"
      );
      await field.locator('[data-testid="entity-select-trigger"]').click();
      await page.waitForSelector('[data-testid="entity-select-listbox"]', { timeout: 10000 });
      await expect(page.locator(`[data-testid="entity-option-${formulationA.id}"]`)).toBeVisible();
      // Positive control: an active formulation is listed, so the list has
      // settled before the absence is asserted.
      await expect(page.locator('[role="option"]').filter({ hasText: formulationA.name })).toBeVisible();
      await expect(page.locator(`[data-testid="entity-option-${archived.id}"]`)).toHaveCount(0);
      await expect(page.locator('[role="option"]').filter({ hasText: archived.name })).toHaveCount(0);
      // The search box only appears for long lists; when it does, an archived code still finds nothing.
      const search = page.locator('[data-testid="entity-select-search"]');
      if (await search.isVisible()) {
        await search.fill(archived.code);
        await expect(page.locator('[role="option"]').filter({ hasText: formulationA.name })).toHaveCount(0);
        await expect(page.locator(`[data-testid="entity-option-${archived.id}"]`)).toHaveCount(0);
      }
    } finally {
      await deleteTestFormulation(archived.id).catch(() => {});
    }
  });

  test("a bin keeping an archived formulation shows it, and the picker opens a read-only View with Restore", async ({
    adminPage: page,
  }) => {
    const id = generateTestId("pbf-stored");
    const tag = id.toUpperCase();
    const stored = await createTestFormulation({ code: `E2E-PBF-STORED-${tag}`, name: `E2E PBF Stored ${id}`, biocharRatio: 0.5 });
    const storedBin = await createTestStorageLocation(facility.id, {
      code: `E2E-PBF-BINS-${tag}`, name: `E2E PBF Stored Bin ${id}`, type: "product_bin", formulationId: stored.id,
    });
    const { db, pool } = createDbConnection();
    try {
      await db.update(schema.formulations).set({ archivedAt: new Date() }).where(eq(schema.formulations.id, stored.id));
    } finally {
      await pool.end();
    }

    try {
      await page.goto(`/storage-locations?facility=${facility.id}`);
      await page.getByLabel("Search storage").fill(storedBin.name);
      const card = page.locator("article").filter({ hasText: storedBin.name });
      await expect(async () => {
        await card.getByRole("button", { name: `Actions for ${storedBin.code}` }).click({ timeout: 5_000 });
        await page.getByRole("menuitem", { name: "Edit", exact: true }).click({ timeout: 5_000 });
      }).toPass({ timeout: 30_000 });
      await waitForSideSheet(page);

      const trigger = page.getByRole("dialog").locator('[data-testid="entity-select-trigger"]').filter({ hasText: stored.name });
      await expect(trigger).toContainText("(Archived)", { timeout: 15000 });
      await trigger.click();
      await page.getByTestId("entity-select-edit").click();

      const view = page.getByTestId("formulation-edit-dialog");
      await expect(view.getByText("This formulation is archived. Pickers hide it and new products, orders and bins cannot use it.")).toBeVisible();
      await expect(view.getByRole("button", { name: "Restore" })).toBeVisible();
      await expect(view.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    } finally {
      await deleteTestStorageLocation(storedBin.id).catch(() => {});
      await deleteTestFormulation(stored.id).catch(() => {});
    }
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

  test("adding a product bin from the side sheet opens the quick-add dialog without navigating", async ({
    adminPage: page,
  }) => {
    const id = generateTestId("pbf-empty");
    const emptyFacility = await createTestFacility({
      code: `E2E-PBF-EMPTY-${id.toUpperCase()}`,
      name: `PBF Empty Facility ${id}`,
    });

    try {
      await page.goto(`/biochar-products?facility=${emptyFacility.id}`);
      await page.waitForLoadState("networkidle");
      await page.click('button:has-text("New product")');
      await waitForSideSheet(page);

      await openProductBinDropdown(page);
      await page.locator('[data-testid="entity-select-create"]').click();

      await expect(page).toHaveURL(/\/biochar-products/);
      await expect(page.locator('[data-testid="storage-location-quick-add-dialog"]')).toBeVisible();

      const dialogBackdrop = page.locator(
        '[data-overlay-layer="dialog-backdrop"]'
      );
      const sideSheet = page.locator(".slide-over-panel-popup");
      const [dialogBackdropZIndex, sideSheetZIndex] = await Promise.all([
        dialogBackdrop.evaluate((element) =>
          Number.parseInt(getComputedStyle(element).zIndex, 10)
        ),
        sideSheet.evaluate((element) =>
          Number.parseInt(getComputedStyle(element).zIndex, 10)
        ),
      ]);

      expect(
        dialogBackdropZIndex,
        "the centered dialog backdrop should darken the open side sheet"
      ).toBeGreaterThan(sideSheetZIndex);
    } finally {
      await deleteTestFacility(emptyFacility.id).catch(() => {});
    }
  });
});
