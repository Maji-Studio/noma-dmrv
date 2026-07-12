import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import * as schema from "../../src/db/schema";
import {
  createDirectAuthContext,
  expect,
  test as base,
  type TestUser,
} from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";
import { hashPassword } from "./fixtures/hash-password";

const TEST_PASSWORD = "TestPassword123!";

// A dedicated org with zero facilities: FacilityProvider auto-selects the
// first facility of the active org, so the gate is only deterministic for an
// org that cannot have one (the shared admin org gains facilities from other
// specs' seed data).
const test = base.extend<{ facilityLessPage: Page }>({
  facilityLessPage: async ({ browser }, provide) => {
    const tag = crypto.randomUUID().slice(0, 8);
    const ids = {
      organization: `e2e-no-fac-org-${tag}`,
      user: `e2e-no-fac-user-${tag}`,
      account: `e2e-no-fac-account-${tag}`,
      member: `e2e-no-fac-member-${tag}`,
    };
    const user: TestUser = {
      id: ids.user,
      email: `no-facility-member-${tag}@e2e.local`,
      name: "No-Facility E2E Member",
      role: "user",
      password: TEST_PASSWORD,
      projectRole: "member",
    };
    const { db, pool } = createDbConnection();
    let context: Awaited<ReturnType<typeof createDirectAuthContext>> | null =
      null;

    try {
      const passwordHash = await hashPassword(TEST_PASSWORD);
      await db.transaction(async (tx) => {
        await tx.insert(schema.organizations).values({
          id: ids.organization,
          name: `No-Facility Org ${tag}`,
          slug: `no-fac-org-${tag}`,
        });
        await tx.insert(schema.users).values({
          id: ids.user,
          email: user.email,
          name: user.name,
          role: user.role,
          emailVerified: true,
        });
        await tx.insert(schema.accounts).values({
          id: ids.account,
          userId: ids.user,
          accountId: `no-fac-${tag}`,
          providerId: "credential",
          password: passwordHash,
        });
        await tx.insert(schema.members).values({
          id: ids.member,
          organizationId: ids.organization,
          userId: ids.user,
          role: "member",
        });
      });

      const baseURL =
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3100";
      context = await createDirectAuthContext(browser, user, baseURL);
      const page = await context.newPage();

      await provide(page);
    } finally {
      await context?.close();
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.sessions)
          .where(eq(schema.sessions.userId, ids.user));
        await tx
          .delete(schema.members)
          .where(eq(schema.members.id, ids.member));
        await tx
          .delete(schema.accounts)
          .where(eq(schema.accounts.id, ids.account));
        await tx.delete(schema.users).where(eq(schema.users.id, ids.user));
        await tx
          .delete(schema.organizations)
          .where(eq(schema.organizations.id, ids.organization));
      });
      await pool.end();
    }
  },
});

test("facility-scoped lists render one operator gate and no inactive controls", async ({
  facilityLessPage: page,
}, testInfo) => {
  await page.goto("/applications");
  await expect(
    page.getByRole("heading", { name: "Applications", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Select a facility", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "New Application", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("table")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("applications-select-facility.png"),
    fullPage: true,
  });

  await page.goto("/certification/production-processes");
  await expect(
    page.getByRole("heading", {
      name: "Production Processes",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Select a facility", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Unlock", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Start new process", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("table")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("production-processes-select-facility.png"),
    fullPage: true,
  });
});
