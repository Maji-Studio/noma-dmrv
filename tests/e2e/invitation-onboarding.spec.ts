import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { test, expect } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { accounts, invitations, members, organizations, sessions, users } from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";

const VALIDITY_MS = 60_000;
const SETUP_INVITATION_VALIDITY_MS = 600_000;
if (!process.env.DATABASE_URL) {
  throw new Error("Set DATABASE_URL before running invitation onboarding tests.");
}
const { db, pool } = createDbConnection();
const ids: string[] = [];

async function invite(email: string, inviterId: string, expired = false) {
  const id = `e2e-invitation-${randomUUID()}`;
  ids.push(id);
  await db.insert(invitations).values({
    id, email, inviterId, organizationId: DEC_ORG_ID, role: "member", status: "pending",
    expiresAt: new Date(Date.now() + (expired ? -VALIDITY_MS : VALIDITY_MS)),
  });
  return `/accept-invitation/${id}`;
}

test.afterEach(async () => {
  if (ids.length) await db.delete(invitations).where(inArray(invitations.id, ids.splice(0)));
});
test.afterAll(async () => pool.end());

test("anonymous invitation onboarding reaches new-account setup and rejects expiry", async ({ page, testUsers }) => {
  const path = await invite(`new-${randomUUID()}@e2e.local`, testUsers.admin.id);
  await page.goto(path);
  await expect(page).toHaveURL(path);
  await expect(page.getByRole("button", { name: "Create account and join" })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await db.update(invitations).set({ expiresAt: new Date(Date.now() - VALIDITY_MS) }).where(eq(invitations.id, ids[0]));
  await page.reload();
  await expect(page.getByText("This invitation is invalid, expired, or already used.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account and join" })).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?from=%2Fdashboard/);
});

test("existing invitee reaches sign-in while the wrong signed-in user remains refused", async ({ page, operatorPage, testUsers }) => {
  const path = await invite(testUsers.viewer.email, testUsers.admin.id);
  await page.goto(path);
  await expect(page).toHaveURL(`/login?from=${encodeURIComponent(path)}`);
  await operatorPage.goto(path);
  await expect(operatorPage.getByText("Sign out, then sign in with the invited email address.", { exact: true })).toBeVisible();
  await expect(operatorPage.getByRole("button", { name: "Accept invitation", exact: true })).toHaveCount(0);
  await expect(operatorPage.getByRole("button", { name: "Create account and join" })).toHaveCount(0);
});

for (const role of ["admin", "member"] as const) {
  test(`a new invited ${role} lands on the appropriate dashboard setup state`, async ({ page, testUsers }) => {
    const tag = randomUUID();
    const organizationId = `e2e-invited-org-${tag}`;
    const invitationId = `e2e-invited-setup-${tag}`;
    const email = `invited-setup-${tag}@e2e.local`;
    await db.insert(organizations).values({ id: organizationId, name: `E2E Invited Org ${tag}`, slug: `e2e-invited-${tag}` });
    try {
      await db.insert(invitations).values({
        id: invitationId, email, inviterId: testUsers.admin.id, organizationId, role,
        status: "pending", expiresAt: new Date(Date.now() + SETUP_INVITATION_VALIDITY_MS),
      });
      await page.goto(`/accept-invitation/${invitationId}`);
      // Client-side validation is a hydration signal before entering the draft.
      await page.getByRole("button", { name: "Create account and join" }).click();
      await expect(page.getByText("Name is required.", { exact: true })).toBeVisible();
      await page.getByRole("textbox", { name: "Name", exact: true }).fill(`E2E Invited ${role}`);
      await page.getByLabel("Password", { exact: true }).fill("TestPassword123!");
      await page.getByRole("button", { name: "Create account and join" }).click();
      await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
      if (role === "admin") {
        const guide = page.getByRole("region", { name: "Getting started" });
        await expect(guide.getByRole("button", { name: "Add facility" })).toBeVisible();
        await expect(guide.locator('[aria-current="step"]').getByText("Add your facility")).toBeVisible();
      } else {
        await expect(page.getByRole("heading", { name: "Setup in progress" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Getting started" })).toHaveCount(0);
      }
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } finally {
      const [invitee] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      await db.delete(invitations).where(eq(invitations.organizationId, organizationId));
      await db.delete(members).where(eq(members.organizationId, organizationId));
      if (invitee) {
        await db.delete(sessions).where(eq(sessions.userId, invitee.id));
        await db.delete(accounts).where(eq(accounts.userId, invitee.id));
        await db.delete(users).where(eq(users.id, invitee.id));
      }
      await db.delete(organizations).where(eq(organizations.id, organizationId));
    }
  });
}
