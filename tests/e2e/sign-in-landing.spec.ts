/**
 * Where signing in lands (#1277, wave 2 decisions 1 and 2): every Platform
 * Admin starts on the Platform home, even one who is also an organization
 * member; everyone else starts on the dashboard. The server decides.
 */
import type { Browser } from "@playwright/test";
import { test, expect } from "./fixtures";
import type { TestUser } from "./fixtures/auth-fixtures";

async function signIn(browser: Browser, user: TestUser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.locator('button[type="submit"]').click();
  return { context, page };
}

test.describe("Sign-in landing", () => {
  test("a Platform Admin who is also a member lands on the Platform home", async ({ browser, testUsers }) => {
    const { context, page } = await signIn(browser, testUsers.admin);
    try {
      await page.waitForURL(/\/admin\/organizations(?:[?#]|$)/, { timeout: 60_000 });
      await expect(page.getByRole("heading", { name: "Organizations", exact: true }).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("a member lands on the dashboard", async ({ browser, testUsers }) => {
    const { context, page } = await signIn(browser, testUsers.operator);
    try {
      await page.waitForURL(/\/dashboard(?:[?#]|$)/, { timeout: 60_000 });
    } finally {
      await context.close();
    }
  });

  test("an explicit return path still wins for a Platform Admin", async ({ browser, testUsers }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto("/login?from=%2Fsettings%2Fgeneral");
      await page.locator('input[type="email"]').fill(testUsers.admin.email);
      await page.locator('input[type="password"]').fill(testUsers.admin.password);
      await page.locator('button[type="submit"]').click();
      await page.waitForURL(/\/settings\/general(?:[?#]|$)/, { timeout: 60_000 });
    } finally {
      await context.close();
    }
  });
});
