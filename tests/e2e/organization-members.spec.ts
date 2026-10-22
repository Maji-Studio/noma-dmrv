/**
 * Settings, Members (#1391): change a role, remove a member, send an
 * invitation again, and leave the organization. Every test runs in its own
 * dedicated organization, so nothing touches the shared Dark Earth Carbon
 * roster. CI has no Resend keys: a resent invitation is saved and the notice
 * says the email did not send.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BrowserContext, Page } from "@playwright/test";
import * as schema from "../../src/db/schema";
import { expect, test } from "./fixtures";
import { createDirectAuthContext } from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";
import { seedDedicatedOrg } from "./fixtures/dedicated-org";
import { enterDefaultOrganization } from "./fixtures/organization-helpers";

const MEMBERS_PATH = "/settings/members";
const HYDRATION_TIMEOUT_MS = 30_000;
const DAY_MS = 86_400_000;
const LAST_ADMIN_REFUSAL = "An organization must keep at least one Admin.";

type Fixture = Awaited<ReturnType<typeof seedDedicatedOrg>>;

/** Adds a second member (user and membership) to the fixture's organization. */
async function addMember(fixture: Fixture, role: "admin" | "member") {
  const tag = randomUUID();
  const user = { id: `e2e-members-user-${tag}`, email: `members-${tag}@e2e.local`, name: `E2E Teammate ${tag.slice(0, 8)}` };
  const { db, pool } = createDbConnection();
  try {
    await db.insert(schema.users).values({ ...user, role: "user", emailVerified: true });
    await db.insert(schema.members).values({
      id: `e2e-members-member-${tag}`, organizationId: fixture.organizationId, userId: user.id, role,
    });
  } finally {
    await pool.end();
  }
  return user;
}

async function removeUser(userId: string) {
  const { db, pool } = createDbConnection();
  try {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  } finally {
    await pool.end();
  }
}

async function openMembers(page: Page, fixture: Fixture) {
  await page.goto(MEMBERS_PATH);
  await expect(page.getByRole("heading", { name: "Members", exact: true, level: 1 })).toBeVisible({ timeout: HYDRATION_TIMEOUT_MS });
  // Typing before hydration loses the values (docs/testing.md).
  await expect(page.locator("aside").getByText(fixture.user.name)).toBeVisible({ timeout: HYDRATION_TIMEOUT_MS });
  await page.waitForLoadState("networkidle");
}

async function signedInAs(fixture: Fixture, browser: Parameters<typeof createDirectAuthContext>[0], baseURL: string) {
  const context: BrowserContext = await createDirectAuthContext(browser, fixture.user, baseURL);
  return { context, page: await context.newPage() };
}

test.describe("Settings, Members", () => {
  test("an Admin changes a member's role and removes the member", async ({ browser, baseURL }) => {
    const fixture = await seedDedicatedOrg({ role: "admin", withRegistryKeys: false });
    const teammate = await addMember(fixture, "member");
    const { context, page } = await signedInAs(fixture, browser, baseURL!);
    try {
      await openMembers(page, fixture);
      const row = page.getByRole("listitem").filter({ hasText: teammate.email });
      await row.getByLabel(`Role for ${teammate.email}`).selectOption("admin");
      await expect(page.getByText("Role updated.")).toBeVisible();
      await expect(row.getByLabel(`Role for ${teammate.email}`)).toHaveValue("admin");

      await row.getByRole("button", { name: "Remove" }).click();
      const dialog = page.getByRole("dialog", { name: "Remove member" });
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(page.getByText("Member removed.")).toBeVisible();
      await expect(row).toHaveCount(0);
    } finally {
      await context.close();
      await removeUser(teammate.id);
      await fixture.cleanup();
    }
  });

  test("an Admin sends an expired invitation again and sees the delivery notice", async ({ browser, baseURL }) => {
    const fixture = await seedDedicatedOrg({ role: "admin", withRegistryKeys: false });
    const email = `expired-${randomUUID()}@e2e.local`;
    const { db, pool } = createDbConnection();
    const { context, page } = await signedInAs(fixture, browser, baseURL!);
    try {
      await db.insert(schema.invitations).values({
        id: `e2e-members-invitation-${randomUUID()}`, organizationId: fixture.organizationId, inviterId: fixture.user.id,
        email, role: "member", status: "pending", expiresAt: new Date(Date.now() - 3 * DAY_MS),
      });
      await openMembers(page, fixture);
      const row = page.getByRole("listitem").filter({ hasText: email });
      await expect(row.getByText(/Expired \w{3} \d{1,2}, \d{4}/)).toBeVisible();
      await expect(row.getByText(/Expired/)).toHaveCount(1);

      await row.getByRole("button", { name: "Send again" }).click();
      await expect(page.getByText(`The email to ${email} did not send`)).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Invitation link" })).toHaveValue(/\/accept-invitation\/.+/);
      // The old row is replaced by a fresh seven-day invitation.
      await expect(row).toHaveCount(1);
      await expect(row.getByText(/Expired/)).toHaveCount(0);
      await expect(row.getByText(/Expires \w{3} \d{1,2}, \d{4}/)).toBeVisible();
    } finally {
      await context.close();
      await pool.end();
      await fixture.cleanup();
    }
  });

  test("a member leaves the organization and loses access", async ({ browser, baseURL }) => {
    const fixture = await seedDedicatedOrg({ role: "member", withRegistryKeys: false });
    const { context, page } = await signedInAs(fixture, browser, baseURL!);
    const { db, pool } = createDbConnection();
    try {
      await openMembers(page, fixture);
      await expect(page.getByRole("button", { name: "Invite member" })).toHaveCount(0);
      await page.getByRole("button", { name: `Leave ${fixture.organizationName}` }).click();
      const dialog = page.getByRole("dialog", { name: `Leave ${fixture.organizationName}?` });
      await expect(dialog).toContainText("You lose access to its data straight away.");
      await dialog.getByRole("button", { name: "Leave organization" }).click();
      await expect(page).not.toHaveURL(new RegExp(`${MEMBERS_PATH}(?:[?#]|$)`), { timeout: HYDRATION_TIMEOUT_MS });
      const left = await db.select().from(schema.members).where(eq(schema.members.userId, fixture.user.id));
      expect(left).toHaveLength(0);
    } finally {
      await context.close();
      await pool.end();
      await fixture.cleanup();
    }
  });

  test("the last Admin cannot leave and the dialog says why", async ({ browser, baseURL }) => {
    const fixture = await seedDedicatedOrg({ role: "admin", withRegistryKeys: false });
    const { context, page } = await signedInAs(fixture, browser, baseURL!);
    const { db, pool } = createDbConnection();
    try {
      await openMembers(page, fixture);
      await page.getByRole("button", { name: `Leave ${fixture.organizationName}` }).click();
      const dialog = page.getByRole("dialog", { name: `Leave ${fixture.organizationName}?` });
      await dialog.getByRole("button", { name: "Leave organization" }).click();
      await expect(dialog.getByRole("alert")).toContainText(LAST_ADMIN_REFUSAL);
      await expect(page).toHaveURL(new RegExp(`${MEMBERS_PATH}(?:[?#]|$)`));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
      const kept = await db.select().from(schema.members).where(eq(schema.members.userId, fixture.user.id));
      expect(kept).toHaveLength(1);
    } finally {
      await context.close();
      await pool.end();
      await fixture.cleanup();
    }
  });

  test("a Platform Admin without a membership sees no Leave control", async ({ adminPage }) => {
    await enterDefaultOrganization(adminPage);
    await adminPage.goto(MEMBERS_PATH);
    await expect(adminPage.getByRole("heading", { name: "Members", exact: true, level: 1 })).toBeVisible({ timeout: HYDRATION_TIMEOUT_MS });
    await expect(adminPage.getByRole("button", { name: "Invite member" })).toBeVisible();
    await expect(adminPage.getByRole("button", { name: /^Leave / })).toHaveCount(0);
  });
});
