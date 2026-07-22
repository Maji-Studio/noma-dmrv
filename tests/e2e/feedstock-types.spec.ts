/**
 * Feedstock Types E2E Tests
 *
 * Covers the Infrastructure catalogue page that replaced the old
 * /certification/production-processes surface (ADR 0022):
 * - navigation: Feedstock Types under Infrastructure, Production Processes gone
 * - UI CRUD lifecycle: create → edit → archive → unarchive → delete (unused)
 *   The lifecycle ends in deletion so the spec leaves no rows behind (feedstock
 *   type codes are auto-generated and would escape the E2E- teardown sweep).
 * - sampling gating: without an Isometric registry connection the detail panel
 *   shows no Sampling section
 */
import { test, expect } from "./fixtures";
import { waitForSideSheet, waitForSideSheetClose } from "./fixtures";

test.describe("Feedstock Types navigation", () => {
  test("sidebar lists Feedstock Types under Infrastructure and has no Production Processes entry", async ({
    adminPage: page,
  }) => {
    await page.goto("/feedstock-types");
    await page.waitForLoadState("networkidle");

    const sidebar = page.locator("aside, nav").first();
    await expect(
      sidebar.getByRole("link", { name: "Feedstock Types" }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Production Processes" }),
    ).toHaveCount(0);
  });

  test("the old production-processes route no longer exists", async ({
    adminPage: page,
  }) => {
    const response = await page.goto("/certification/production-processes");
    // The route was deleted; depending on the certification layout guard the
    // app either 404s or redirects away — it must not render the old page.
    const status = response?.status() ?? 0;
    if (status === 200) {
      await expect(page).not.toHaveURL(/certification\/production-processes/);
    } else {
      expect(status).toBe(404);
    }
  });
});

test.describe("Feedstock Types UI CRUD", () => {
  test("admin can create, edit, archive, unarchive, and delete an unused type", async ({
    adminPage: page,
  }) => {
    const uniqueName = `E2E FT Walnut Shells ${Date.now()}`;
    const editedName = `${uniqueName} Edited`;

    await page.goto("/feedstock-types");
    await page.waitForLoadState("networkidle");

    // ── Create ────────────────────────────────────────────────────────────
    await page.click('button:has-text("New Feedstock Type")');
    await waitForSideSheet(page);
    await page.selectOption("#usage", "pyrolysis");
    await page.fill("#name", uniqueName);
    await page.selectOption("#category", "agricultural");
    await page
      .locator('[role="dialog"]')
      .locator('button:has-text("Create Feedstock Type")')
      .click();
    await waitForSideSheetClose(page);

    const row = page.locator("table tbody tr", { hasText: uniqueName });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText("Pyrolysis");
    await expect(row).toContainText("Agricultural");
    await expect(row).toContainText("Active");

    const openRowActions = async (name: string) => {
      await page
        .locator("table tbody tr", { hasText: name })
        .getByRole("button", { name: /Actions for/ })
        .click();
    };

    // ── Edit ──────────────────────────────────────────────────────────────
    await openRowActions(uniqueName);
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await waitForSideSheet(page);
    await page.fill("#name", editedName);
    await page
      .locator('[role="dialog"]')
      .locator('button:has-text("Save Changes")')
      .click();
    await waitForSideSheetClose(page);
    const editedRow = page.locator("table tbody tr", { hasText: editedName });
    await expect(editedRow).toBeVisible({ timeout: 10000 });

    // ── Archive ───────────────────────────────────────────────────────────
    await openRowActions(editedName);
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(editedRow).toContainText("Archived", { timeout: 10000 });
    // Archived rows render muted values (opacity treatment via data-archived).
    await expect(
      editedRow.locator('[data-archived="true"]').first(),
    ).toBeVisible();

    // The archive filter hides it from the Active view.
    await page.selectOption(
      'select[aria-label="Filter feedstock types by archive state"]',
      "active",
    );
    await expect(
      page.locator("table tbody tr", { hasText: editedName }),
    ).toHaveCount(0);
    await page.selectOption(
      'select[aria-label="Filter feedstock types by archive state"]',
      "all",
    );

    // ── Unarchive ─────────────────────────────────────────────────────────
    await openRowActions(editedName);
    await page.getByRole("menuitem", { name: "Unarchive" }).click();
    await expect(editedRow).toContainText("Active", { timeout: 10000 });

    // ── Delete (unused → allowed, and cleans up this spec's row) ─────────
    await openRowActions(editedName);
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page
      .getByRole("button", { name: /^Delete/ })
      .last()
      .click();
    await expect(
      page.locator("table tbody tr", { hasText: editedName }),
    ).toHaveCount(0, { timeout: 10000 });
  });

  test("detail panel shows no Sampling section without an Isometric registry connection", async ({
    adminPage: page,
    seededData,
  }) => {
    // The seeded facility has no registry mapping, so the Isometric-gated
    // sampling surface must stay hidden even for a pyrolysis-usage type.
    await page.goto(`/feedstock-types?facility=${seededData.facility.id}`);
    await page.waitForLoadState("networkidle");

    const seededRow = page.locator("table tbody tr", {
      hasText: seededData.feedstockType.name,
    });
    await expect(seededRow).toBeVisible({ timeout: 10000 });
    await seededRow.click();
    await waitForSideSheet(page);

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toContainText("Catalogue");
    await expect(dialog.getByText("Sampling", { exact: true })).toHaveCount(0);
    await expect(
      dialog.locator('[data-testid="feedstock-type-sampling"]'),
    ).toHaveCount(0);
  });
});
