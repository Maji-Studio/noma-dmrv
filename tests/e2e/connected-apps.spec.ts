import { expect, test as authTest } from "./fixtures";
import { DEC_ORG_ID } from "../../src/db/org-defaults";
import {
  createE2EOAuthClient, readE2EOAuthGrant, removeE2EOAuthClient, seedE2EOAuthConnection, type E2EOAuthClient,
} from "./fixtures/oauth-helpers";

const UI_TIMEOUT_MS = 30_000;
const PHONE = { width: 390, height: 844 };
const SCOPES = ["feedstocks:read", "orders:read", "feedstocks:write"];

const test = authTest.extend<{ client: E2EOAuthClient }>({
  client: async ({}, provide) => {
    const client = await createE2EOAuthClient(SCOPES);
    try { await provide(client); } finally { await removeE2EOAuthClient(client); }
  },
});

test("a Member sees and disconnects their own connection", async ({ operatorPage: page, testUsers, client }) => {
  const grantId = await seedE2EOAuthConnection({ client, organizationId: DEC_ORG_ID, userId: testUsers.operator.id, scopes: SCOPES });
  await page.goto("/settings/connected-apps");
  const rail = page.getByRole("navigation", { name: "Settings categories" });
  await expect(rail.getByRole("link", { name: "Connected apps", exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS });
  const own = page.getByRole("list", { name: "Your connections", exact: true });
  await expect(own.getByText("E2E OAuth client")).toBeVisible();
  await expect(own.getByText("e2e-oauth.example.test")).toBeVisible();
  await expect(page.getByRole("heading", { name: "All members" })).toHaveCount(0);

  await own.getByRole("button", { name: "Disconnect E2E OAuth client", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/It stops working in .* at once\. Records it saved stay\./)).toBeVisible();
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("No connected apps")).toBeVisible();
  expect((await readE2EOAuthGrant(grantId)).revokedAt).not.toBeNull();
});

test("an Admin also sees All members and can disconnect another member's app", async ({ orgAdminPage: page, testUsers, client }) => {
  await seedE2EOAuthConnection({ client, organizationId: DEC_ORG_ID, userId: testUsers.org_admin.id, scopes: SCOPES });
  const memberGrant = await seedE2EOAuthConnection({ client, organizationId: DEC_ORG_ID, userId: testUsers.operator.id, scopes: SCOPES });
  await page.goto("/settings/connected-apps");
  const all = page.getByRole("list", { name: "All members", exact: true });
  await expect(all).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(all.getByText(testUsers.operator.name)).toBeVisible();
  await expect(page.getByRole("list", { name: "Your connections", exact: true }).getByText(testUsers.operator.name)).toHaveCount(0);

  await all.getByRole("button", { name: `Disconnect E2E OAuth client for ${testUsers.operator.name}`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(all.getByText(testUsers.operator.name)).toHaveCount(0);
  expect((await readE2EOAuthGrant(memberGrant)).revokedAt).not.toBeNull();
});

test("Connected apps fits a 390 wide phone", async ({ operatorPage: page, testUsers, client }) => {
  await seedE2EOAuthConnection({ client, organizationId: DEC_ORG_ID, userId: testUsers.operator.id, scopes: SCOPES });
  await page.setViewportSize(PHONE);
  await page.goto("/settings/connected-apps");
  const button = page.getByRole("button", { name: "Disconnect E2E OAuth client", exact: true });
  await expect(button).toBeVisible({ timeout: UI_TIMEOUT_MS });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await button.click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
});
