import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { test, expect } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { invitations } from "../../src/db/schema";
import { DEC_ORG_ID } from "../../src/db/org-defaults";

const VALIDITY_MS = 60_000;
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
