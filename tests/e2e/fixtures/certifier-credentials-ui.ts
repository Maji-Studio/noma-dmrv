/**
 * Save an organization's Isometric keys on the Platform Organizations page,
 * so the app server encrypts them with its own key. A Playwright worker must
 * never encrypt credentials itself: locally it holds the dummy key from
 * tests/setup.ts while the dev server holds the real one (#1010).
 */
import type { Locator, Page } from "@playwright/test";
import { expect } from "./auth-fixtures";

export type CertifierKeyLabel = "Access token" | "Client secret";

/**
 * A key input by its accessible name. While nothing is stored the field is
 * required and its name ends in the label's screen-reader-only "Required"; a
 * replacement input's does not. getByLabel matches the label's raw text, which
 * also holds the aria-hidden asterisk, so match the computed name instead.
 */
export function certifierKeyInput(scope: Locator, label: CertifierKeyLabel): Locator {
  return scope.getByRole("textbox", {
    name: new RegExp(`^${label}(?: Required)?$`),
  });
}

/**
 * Picks an organization on the Platform page (`/admin/organizations`) and
 * returns its panel, the right-hand side that names the organization.
 */
export async function openPlatformOrganization(
  page: Page,
  organizationName: string,
): Promise<Locator> {
  await page.goto("/admin/organizations");
  await page
    .getByRole("navigation", { name: "Organizations" })
    .getByRole("button")
    .filter({ has: page.getByText(organizationName, { exact: true }) })
    .click();
  const panel = page.getByRole("article", { name: organizationName });
  await expect(panel).toBeVisible();
  return panel;
}

/** The organization's Isometric keys section on the Platform page. */
export async function openCertifierKeys(
  page: Page,
  organizationName: string,
): Promise<Locator> {
  const panel = await openPlatformOrganization(page, organizationName);
  return panel.getByRole("region", { name: "Isometric keys" });
}

/**
 * Stores both keys, replacing any saved ones, and waits for the save to land.
 * The connection check runs server-side afterwards; callers assert its notice.
 */
export async function saveCertifierKeysInAdminDirectory(
  page: Page,
  organizationName: string,
  credentials: { accessToken: string; clientSecret: string },
): Promise<Locator> {
  const keys = await openCertifierKeys(page, organizationName);
  const fields: [CertifierKeyLabel, string][] = [
    ["Access token", credentials.accessToken],
    ["Client secret", credentials.clientSecret],
  ];
  for (const [label, value] of fields) {
    const input = certifierKeyInput(keys, label);
    const replace = keys.getByRole("button", {
      name: `Replace ${label.toLowerCase()}`,
      exact: true,
    });
    // The form renders after the status query: an input when nothing is
    // stored, a Replace action when a key is.
    await expect(input.or(replace)).toBeVisible();
    if (await replace.isVisible()) await replace.click();
    await input.fill(value);
  }
  await keys.getByRole("button", { name: "Save and test connection" }).click();
  await expect(keys.getByRole("button", { name: /^Replace/ })).toHaveCount(2);
  return keys;
}
