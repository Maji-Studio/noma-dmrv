import { expect, type Locator, type Page } from "@playwright/test";

const DEFAULT_ORGANIZATION_NAME = "Dark Earth Carbon";
const DASHBOARD_URL = /\/dashboard(?:[/?#]|$)/;

/**
 * Enter the bootstrap organization as a Platform Admin with no membership.
 * Idempotent: when it is already the current organization its panel says
 * "You're working in" instead of offering a switch, so go to the dashboard.
 */
export async function enterDefaultOrganization(page: Page): Promise<void> {
  await page.goto("/admin/organizations");
  await page
    .getByRole("navigation", { name: "Organizations" })
    .getByRole("button")
    .filter({ has: page.getByText(DEFAULT_ORGANIZATION_NAME, { exact: true }) })
    .click();
  const panel: Locator = page.getByRole("article", { name: DEFAULT_ORGANIZATION_NAME });
  await expect(panel).toBeVisible();

  const switchButton = panel.getByRole("button", { name: `Switch to ${DEFAULT_ORGANIZATION_NAME}` });
  if ((await switchButton.count()) === 0) {
    await expect(panel).toContainText(`You're working in ${DEFAULT_ORGANIZATION_NAME}.`);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(DASHBOARD_URL);
    return;
  }

  await switchButton.click();
  // Next dev can drop the first action after compiling a sibling route.
  await page.waitForURL(DASHBOARD_URL, { timeout: 5_000 }).catch(() => undefined);
  if (!DASHBOARD_URL.test(page.url())) {
    await switchButton.click();
  }
  await expect(page).toHaveURL(DASHBOARD_URL);
}
