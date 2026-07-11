import { expect, type Locator, type Page } from "@playwright/test";

const DEFAULT_ORGANIZATION_NAME = "Dark Earth Carbon";
const DASHBOARD_URL = /\/dashboard(?:[/?#]|$)/;

function sectionWithHeading(page: Page, heading: string): Locator {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: heading, exact: true }),
  });
}

/** Enter the bootstrap organization as a Platform Admin with no membership. */
export async function enterDefaultOrganization(page: Page): Promise<void> {
  await page.goto("/admin/organizations");

  const organization = sectionWithHeading(page, "Organizations")
    .getByRole("listitem")
    .filter({ hasText: DEFAULT_ORGANIZATION_NAME });

  await expect(organization).toBeVisible();
  const enterButton = organization.getByRole("button", { name: "Enter" });

  await enterButton.click();
  // Next dev can drop the first action after compiling a sibling route.
  await page.waitForURL(DASHBOARD_URL, { timeout: 5_000 }).catch(() => undefined);
  if (!DASHBOARD_URL.test(page.url())) {
    await enterButton.click();
  }
  await expect(page).toHaveURL(DASHBOARD_URL);
}
