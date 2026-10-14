/**
 * Save an organization's Isometric keys through the Platform Admin directory,
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

/** Opens the organization's keys dialog in the admin directory and returns it. */
export async function openCertifierKeysDialog(
  page: Page,
  organizationName: string,
): Promise<Locator> {
  await page.goto("/admin/organizations");
  const organization = page
    .getByRole("listitem")
    .filter({ hasText: organizationName });
  await expect(organization).toBeVisible();
  await organization.getByRole("button", { name: "Isometric keys" }).click();
  return page.getByRole("dialog");
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
  const keys = await openCertifierKeysDialog(page, organizationName);
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
