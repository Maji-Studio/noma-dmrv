/**
 * Settings, Profile (#1277 wave 2): a member renames themselves and changes
 * their password. The change signs out every other device, keeps this one
 * signed in, and the old password stops working. Runs on a dedicated
 * organization and user, so the shared admin's password is never touched.
 */
import type { BrowserContext } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createDirectAuthContext } from "./fixtures/auth-fixtures";
import { seedDedicatedOrg } from "./fixtures/dedicated-org";

const NEW_NAME = "E2E Renamed Member";
const NEW_PASSWORD = "E2eChangedPassword456!";
const PROFILE_PATH = "/settings/profile";
const HYDRATION_TIMEOUT_MS = 15_000;

test.describe("Settings, Profile", () => {
  test("renames you and changes your password, signing out other devices", async ({ browser, baseURL }) => {
    const fixture = await seedDedicatedOrg({ role: "member", withRegistryKeys: false });
    const contexts: BrowserContext[] = [];
    try {
      const here = await createDirectAuthContext(browser, fixture.user, baseURL!);
      const elsewhere = await createDirectAuthContext(browser, fixture.user, baseURL!);
      contexts.push(here, elsewhere);
      const page = await here.newPage();
      const otherDevice = await elsewhere.newPage();
      await otherDevice.goto("/dashboard");
      await expect(otherDevice).toHaveURL(/\/dashboard/);

      await page.goto(PROFILE_PATH);
      await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
      // The sidebar shows the name once the session has hydrated; typing
      // before then loses the values (docs/testing.md).
      await expect(page.locator("aside").getByText(fixture.user.name)).toBeVisible({ timeout: HYDRATION_TIMEOUT_MS });
      await expect(page.getByRole("main").getByText(fixture.user.email)).toBeVisible();

      await page.getByLabel("Name").fill(NEW_NAME);
      await page.getByRole("button", { name: "Save name" }).click();
      await expect(page.getByText("Name saved.")).toBeVisible();
      // The sidebar's user row follows without a reload.
      await expect(page.locator("aside").getByText(NEW_NAME)).toBeVisible();

      await page.getByLabel("Current password").fill("not-the-password");
      await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
      await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Change password" }).click();
      await expect(page.getByText("That is not your current password.").first()).toBeVisible();

      await page.getByLabel("Current password").fill(fixture.user.password);
      await page.getByRole("button", { name: "Change password" }).click();
      await expect(page.getByText("Password changed. Other devices are signed out within 5 minutes.")).toBeVisible();

      // This device stays signed in; the other one is sent to sign in once its
      // signed session snapshot (up to 5 minutes) is gone, which clearing that
      // one cookie stands in for.
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`${PROFILE_PATH}(?:[?#]|$)`));
      await elsewhere.clearCookies({ name: /session_data/ });
      await otherDevice.goto("/dashboard");
      await expect(otherDevice).toHaveURL(/\/login/);

      // The old password no longer signs in; the new one does.
      const fresh = await browser.newContext();
      contexts.push(fresh);
      const login = await fresh.newPage();
      await login.goto("/login");
      await login.fill('input[type="email"]', fixture.user.email);
      await login.fill('input[type="password"]', fixture.user.password);
      await login.click('button[type="submit"]');
      // Wait for the refusal itself: the page is on /login before it answers.
      await expect(login.getByRole("alert")).toBeVisible();
      await expect(login).toHaveURL(/\/login/);
      await login.fill('input[type="password"]', NEW_PASSWORD);
      await login.click('button[type="submit"]');
      await expect(login).not.toHaveURL(/\/login/, { timeout: 15000 });
    } finally {
      try {
        await Promise.all(contexts.map((context) => context.close()));
      } finally {
        await fixture.cleanup();
      }
    }
  });
});
