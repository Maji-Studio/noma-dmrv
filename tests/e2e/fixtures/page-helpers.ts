/**
 * Shared Playwright Page Helpers
 *
 * Common UI interaction helpers for E2E tests.
 * Extracted from individual spec files to avoid duplication.
 */
import type { Page } from "@playwright/test";

/** Wait for side sheet dialog to open */
export async function waitForSideSheet(page: Page) {
  await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
}

/** Wait for side sheet dialog to close (indicates successful form submission) */
export async function waitForSideSheetClose(page: Page) {
  await page.waitForSelector('[role="dialog"]', {
    state: "hidden",
    timeout: 20000,
  });
}

/** Click an EntitySelect trigger scoped to a field label within the dialog, then click an option by ID */
export async function selectEntity(
  page: Page,
  fieldLabel: string,
  optionId: string,
  searchText?: string
) {
  const dialog = page.locator('[role="dialog"]');
  const label = dialog.locator("label").filter({ hasText: fieldLabel }).first();
  const fieldContainer = label.locator(
    "xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]"
  );

  await fieldContainer.locator('[data-testid="entity-select-trigger"]').click();
  await page.waitForSelector('[data-testid="entity-select-listbox"]', {
    timeout: 10000,
  });

  const optionSelector = `[data-testid="entity-option-${optionId}"]`;
  const option = page.locator(optionSelector).first();

  try {
    await option.waitFor({ state: "visible", timeout: 3000 });
  } catch {
    if (searchText) {
      const searchInput = page.locator('[data-testid="entity-select-search"]');
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill(searchText);
      }
    }
    await option.waitFor({ state: "visible", timeout: 10000 });
  }

  await option.click();
}

/** Click an EntitySelect trigger scoped to a field label within the dialog, then click the first option */
export async function selectFirstEntity(page: Page, fieldLabel: string) {
  const dialog = page.locator('[role="dialog"]');
  const label = dialog.locator("label").filter({ hasText: fieldLabel }).first();
  const fieldContainer = label.locator(
    "xpath=ancestor::div[.//*[@data-testid='entity-select-trigger']][1]"
  );

  await fieldContainer.locator('[data-testid="entity-select-trigger"]').click();
  await page.waitForSelector('[data-testid="entity-select-listbox"]', {
    timeout: 10000,
  });
  await page.locator('[role="option"]').first().click();
}
