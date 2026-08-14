/**
 * Entity side-sheet unsaved-changes guard (DR-004 regression).
 *
 * The sheet must never silently discard edit work: Escape, backdrop, the
 * close icon, Cancel and the back arrow all funnel through a confirm dialog
 * once the form is dirty. Dirtiness has two sources — a native input/change
 * heuristic, and the form's authoritative RHF `formState.isDirty` reported
 * through the sheet context (the only source that sees programmatic
 * `setValue` from custom widgets such as entity selects). Both are covered
 * here: typed work in a plain input, and a click-only entity-select change
 * that dispatches no native form events.
 */
import { test, expect } from "./fixtures";
import { waitForSideSheet } from "./fixtures/page-helpers";
import {
  createTestSupplier,
  deleteTestSupplier,
} from "./fixtures/test-data-helpers";

test.describe("Side-sheet discard guard", () => {
  test("guards typed work behind the confirm dialog on Escape and Cancel", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const page = adminPage;

    await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
    const row = page
      .locator("tr", { hasText: seededData.feedstock.code })
      .first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.click();
    await waitForSideSheet(page);

    await page.getByRole("button", { name: "Edit Feedstock" }).click();
    const notesField = page.getByLabel("Notes");
    await expect(notesField).toBeVisible();
    await notesField.fill("E2E discard-guard probe");

    // Escape must confirm, not discard.
    await page.keyboard.press("Escape");
    const dialog = page.getByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    await expect(dialog).toBeVisible();

    // Keep editing preserves the typed value.
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel("Notes")).toHaveValue(
      "E2E discard-guard probe",
    );

    // Cancel funnels through the same guard; confirming returns to the
    // read view without saving.
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Discard changes" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Edit Feedstock" }),
    ).toBeVisible();
  });

  test("guards a click-only entity-select change (no native events)", async ({
    adminPage,
    seededData,
    cleanupTestData,
  }) => {
    void cleanupTestData;
    const page = adminPage;
    const secondSupplier = await createTestSupplier();

    try {
      await page.goto(`/feedstocks?facility=${seededData.facility.id}`);
      const row = page
        .locator("tr", { hasText: seededData.feedstock.code })
        .first();
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.click();
      await waitForSideSheet(page);

      await page.getByRole("button", { name: "Edit Feedstock" }).click();

      // Change only the supplier via the entity select — commits through RHF
      // setValue, which the native-event dirty heuristic cannot see.
      const supplierField = page
        .locator("label")
        .filter({ hasText: "Supplier" })
        .first()
        .locator(
          "xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]",
        );
      await supplierField
        .locator('[data-testid="entity-select-trigger"]')
        .click();
      await page
        .getByRole("option")
        .filter({ hasText: secondSupplier.name })
        .click();

      await page.keyboard.press("Escape");
      const dialog = page.getByRole("dialog", {
        name: "Discard unsaved changes?",
      });
      await expect(dialog).toBeVisible();

      await dialog.getByRole("button", { name: "Discard changes" }).click();
      await expect(dialog).toBeHidden();
    } finally {
      await deleteTestSupplier(secondSupplier.id);
    }
  });
});
