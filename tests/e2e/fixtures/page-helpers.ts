/**
 * Shared Playwright Page Helpers
 *
 * Common UI interaction helpers for E2E tests.
 * Extracted from individual spec files to avoid duplication.
 */
import { expect, type Page } from "@playwright/test";

export const ACTION_LABEL_PREFIX = "Actions for ";

/** Budget for the FacilityProvider to resolve after a navigation. */
export const FACILITY_HYDRATION_TIMEOUT_MS = 15_000;

/**
 * Waits for the facility context to hydrate — the sidebar shows the facility
 * name once the FacilityProvider resolves. Filling a form before then loses
 * the values (docs/testing.md).
 */
export async function waitForFacilityHydration(
  page: Page,
  facilityName: string,
) {
  await expect(
    page.locator("aside").getByText(facilityName, { exact: false }),
  ).toBeVisible({ timeout: FACILITY_HYDRATION_TIMEOUT_MS });
}

export async function getListedActionCodes(
  page: Page,
): Promise<Set<string>> {
  const table = page.getByRole("table", { name: "Production runs" });
  const emptyState = page.getByText(/No production runs (?:yet|found)/, {
    exact: true,
  });
  await expect
    .poll(async () => {
      if (await emptyState.isVisible()) return "false";
      if (await table.count()) return table.getAttribute("aria-busy");
      return "pending";
    })
    .toBe("false");
  const labels = await page
    .locator(`tbody button[aria-label^="${ACTION_LABEL_PREFIX}"]`)
    .evaluateAll(
      (buttons, prefixLength) =>
        buttons
          .map((button) => button.getAttribute("aria-label"))
          .filter((label): label is string => label !== null)
          .map((label) => label.slice(prefixLength)),
      ACTION_LABEL_PREFIX.length,
    );
  return new Set(labels);
}

export async function getCreatedActionCode(
  page: Page,
  existingCodes: Set<string>,
): Promise<string> {
  let createdCodes: string[] = [];
  await expect
    .poll(async () => {
      createdCodes = [...(await getListedActionCodes(page))].filter(
        (code) => !existingCodes.has(code),
      );
      return createdCodes.length;
    })
    .toBe(1);
  const createdCode = createdCodes[0];
  if (!createdCode) throw new Error("Created action code was not rendered");
  return createdCode;
}

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

/**
 * Dismiss the "Link Isometric project" dialog that auto-opens for admins
 * right after a facility is created (facility-list.tsx — intentional,
 * optional prompt). It mounts only once its mapping payload loads, so wait
 * briefly and dismiss if present; absence (e.g. payload fetch failed) is
 * fine because the link is optional by design.
 */
export async function dismissCertifierLinkDialog(page: Page) {
  const linkDialog = page
    .getByRole("dialog")
    .filter({ hasText: "Link Isometric project" });
  const appeared = await linkDialog
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await linkDialog.getByRole("button", { name: "Close" }).click();
    await linkDialog.waitFor({ state: "hidden", timeout: 5000 });
  }
}

/** Click an EntitySelect trigger scoped to a field label within the dialog, then click an option by ID */
export async function selectEntity(
  page: Page,
  fieldLabel: string,
  optionId: string,
  searchText?: string,
  fieldIndex = 0,
) {
  const dialog = page.locator('[role="dialog"]');
  const label = dialog
    .locator("label")
    .filter({ hasText: fieldLabel })
    .nth(fieldIndex);
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

/**
 * Click an EntitySelect trigger scoped to a field label within the dialog,
 * then click the first option whose visible text contains `optionText`.
 * Falls back to the server-side search box when the option isn't in the
 * initial page of results.
 */
export async function selectEntityByText(
  page: Page,
  fieldLabel: string,
  optionText: string
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

  const option = page
    .locator('[role="option"]')
    .filter({ hasText: optionText })
    .first();

  try {
    await option.waitFor({ state: "visible", timeout: 3000 });
  } catch {
    const searchInput = page.locator('[data-testid="entity-select-search"]');
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(optionText);
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

export async function selectFirstCreditBatchProductionRun(
  page: Page,
  feedstockType: { id: string; name: string },
) {
  const dialog = page.locator('[role="dialog"]');
  // The credit-batch form declares one feedstock type (usage="pyrolysis") and
  // scopes the automatic run cohort to it (#356). Select the seeded type by id,
  // then wait for the matching read-only preview before submitting.
  await selectEntity(page, "Feedstock Type", feedstockType.id, feedstockType.name);
  const firstRunPreview = dialog
    .getByTestId("credit-batch-production-run-preview")
    .first();
  await firstRunPreview.waitFor({ state: "visible", timeout: 10000 });
}
