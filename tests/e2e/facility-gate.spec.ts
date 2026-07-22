import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import type { Page } from "@playwright/test";
import * as schema from "../../src/db/schema";
import { hashPassword } from "better-auth/crypto";
import {
  createDirectAuthContext,
  expect,
  test as base,
  type TestUser,
} from "./fixtures/auth-fixtures";
import {
  createTestFacility,
  deleteTestFacility,
  type TestFacility,
} from "./fixtures";
import { createDbConnection } from "./fixtures/db";

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
      const passwordHash = await hashPassword(
        TEST_PASSWORD
      );
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
      try {
        await context?.close();
      } finally {
        try {
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
        } finally {
          await pool.end();
        }
      }
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

});

// Regression for #473: a direct/deep-linked `?facility=<id>` must resolve the
// facility on first load — the shell must never canonicalize the param away or
// flash the "Select a facility" gate before the org-scoped queries prove
// membership. The active org is seeded server-side and verified per query, so
// the facility resolves without any manual org-switcher interaction.
test.describe("Deep-linked facility resolves on direct navigation (#473)", () => {
  let facility: TestFacility;

  test.beforeAll(async () => {
    facility = await createTestFacility();
  });

  test.afterAll(async () => {
    if (facility) await deleteTestFacility(facility.id);
  });

  test("direct navigation to a facility-scoped URL resolves without touching the switcher", async ({
    adminPage: page,
  }) => {
    await page.goto(`/reactors?facility=${facility.id}`);

    // The resolved list surface renders (its create affordance only exists once
    // a facility is selected) — never the "Select a facility" gate.
    await expect(
      page.getByRole("button", { name: "New Reactor", exact: true }).first(),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.getByRole("heading", { name: "Select a facility", exact: true }),
    ).toHaveCount(0);

    // The deep-linked facility survives in the URL (no canonicalize to /reactors)
    // and is the active selection in the sidebar — proving URL-first resolution.
    await expect(page).toHaveURL(new RegExp(`facility=${facility.id}`));
    await expect(page.getByText(facility.name).first()).toBeVisible({
      timeout: 20000,
    });
  });
});
