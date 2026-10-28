/**
 * Where signing in lands (#1277, wave 2 decisions 1 and 2): every Platform
 * Admin starts on the Platform home, a member of an organization or not;
 * everyone else starts on the dashboard. The server decides.
 */
import { randomUUID } from "node:crypto";
import type { Browser } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";
import { test, expect } from "./fixtures";
import type { TestUser } from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";

/** One sign-in, including the dev server compiling the landing page. */
const SIGN_IN_TIMEOUT_MS = 60_000;
/** One attempt at filling and submitting before the next try. */
const SIGN_IN_ATTEMPT_TIMEOUT_MS = 20_000;
const PLATFORM_HOME = /\/platform\/organizations(?:[?#]|$)/;
const DASHBOARD = /\/dashboard(?:[?#]|$)/;

/**
 * Signs in through the real form. The login page has no client-only marker
 * to wait for, so a fill that lands before hydration (and is reset, or posts
 * natively) is retried until the redirect happens (docs/testing.md).
 */
async function signIn(browser: Browser, user: TestUser, landing: RegExp, path = "/login") {
  const context = await browser.newContext();
  const page = await context.newPage();
  await expect(async () => {
    await page.goto(path);
    await page.locator('input[type="email"]').fill(user.email);
    await page.locator('input[type="password"]').fill(user.password);
    await expect(page.locator('input[type="email"]')).toHaveValue(user.email);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(landing, { timeout: SIGN_IN_ATTEMPT_TIMEOUT_MS });
  }).toPass({ timeout: SIGN_IN_TIMEOUT_MS });
  return { context, page };
}

test.describe("Sign-in landing", () => {
  test("a Platform Admin without a membership lands on the Platform home", async ({ browser, testUsers }) => {
    const { context, page } = await signIn(browser, testUsers.admin, PLATFORM_HOME);
    try {
      await expect(page.getByRole("heading", { name: "Organizations", exact: true }).first()).toBeVisible();
      await expect(page.getByRole("region", { name: "Platform Admin" })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("a Platform Admin who is also a member lands on the Platform home", async ({ browser, testUsers }) => {
    const { db, pool } = createDbConnection();
    const memberId = `e2e-landing-member-${randomUUID()}`;
    await db.insert(schema.members).values({
      id: memberId,
      organizationId: DEC_ORG_ID,
      userId: testUsers.admin.id,
      role: "member",
    });
    try {
      const { context } = await signIn(browser, testUsers.admin, PLATFORM_HOME);
      await context.close();
    } finally {
      await db.delete(schema.members).where(eq(schema.members.id, memberId));
      await pool.end();
    }
  });

  test("a member lands on the dashboard", async ({ browser, testUsers }) => {
    const { context } = await signIn(browser, testUsers.operator, DASHBOARD);
    await context.close();
  });

  test("an explicit return path still wins for a Platform Admin", async ({ browser, testUsers }) => {
    const { context } = await signIn(
      browser,
      testUsers.admin,
      /\/settings\/general(?:[?#]|$)/,
      "/login?from=%2Fsettings%2Fgeneral",
    );
    await context.close();
  });
});
