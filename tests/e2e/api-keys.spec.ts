import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { apiKeys } from "@/db/schema";
import { DEC_ORG_ID } from "@/db/org-defaults";
import { expect, test as authTest } from "./fixtures";
import { createDbConnection } from "./fixtures/db";

const UI_TIMEOUT_MS = 30_000;
const NAME_TAG_LENGTH = 8;

const test = authTest.extend<{ apiKeyName: string }>({
  apiKeyName: async ({}, provide) => {
    const name = `E2E API key ${randomUUID().slice(0, NAME_TAG_LENGTH)}`;
    try { await provide(name); }
    finally {
      // Names use the teardown contract. Explicit cleanup also removes the
      // plugin row, which otherwise survives deletion of the fixture owner.
      const { db, pool } = createDbConnection();
      try {
        await db.delete(apiKeys).where(and(eq(apiKeys.name, name), eq(apiKeys.referenceId, DEC_ORG_ID)));
      } finally { await pool.end(); }
    }
  },
});

// The one-time view contains a real local credential. Do not record it in
// trace, video or failure screenshots. Assertions report booleans, not keys.
test.use({ trace: "off", video: "off", screenshot: "off" });

test("an organization Admin creates, closes and revokes an API key", async ({ orgAdminPage: page, apiKeyName }) => {
  // adminPage is a Platform Admin without membership. orgAdminPage has the
  // verified, live organization Admin membership required for key management.
  await page.goto("/settings/api-keys");
  await expect(page.getByRole("heading", { name: "API keys", level: 1, exact: true })).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await page.getByRole("button", { name: "New API key", exact: true }).click();
  const createDialog = page.getByRole("dialog", { name: "Create API key", exact: true });
  await createDialog.getByLabel("Name", { exact: false }).fill(apiKeyName);
  await expect(createDialog.getByRole("checkbox", { name: "Feedstocks Read", exact: true })).toBeChecked();
  await expect(createDialog.getByRole("checkbox", { name: "Feedstocks Write", exact: true })).not.toBeChecked();
  await expect(createDialog.getByRole("checkbox", { name: "Feedstocks Delete", exact: true })).not.toBeChecked();
  await createDialog.getByRole("button", { name: "Create API key", exact: true }).click();

  const createdDialog = page.getByRole("dialog", { name: "API key created", exact: true });
  await expect(createdDialog).toBeVisible();
  const secret = await createdDialog.getByLabel("API key", { exact: true }).inputValue();
  expect(secret.length > 0).toBe(true);
  await expect(createdDialog.getByText(/It will not be shown again/)).toBeVisible();
  await createdDialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const keyRow = page.getByRole("list", { name: "API keys", exact: true }).getByRole("listitem").filter({ hasText: apiKeyName });
  await expect(keyRow).toBeVisible();
  await expect(keyRow.getByText("Active", { exact: true })).toBeVisible();
  expect((await keyRow.innerText()).includes(secret)).toBe(false);
  await expect(page.locator("#api-key-plaintext")).toHaveCount(0);
  await page.reload();
  await expect(keyRow).toBeVisible({ timeout: UI_TIMEOUT_MS });
  expect((await keyRow.innerText()).includes(secret)).toBe(false);
  await expect(page.locator("#api-key-plaintext")).toHaveCount(0);

  await keyRow.getByRole("button", { name: `Revoke ${apiKeyName}`, exact: true }).click();
  const revokeDialog = page.getByRole("dialog", { name: "Revoke API key", exact: true });
  await expect(revokeDialog.getByText(/This cannot be undone/)).toBeVisible();
  await revokeDialog.getByRole("button", { name: "Revoke key", exact: true }).click();
  await expect(revokeDialog).toHaveCount(0);
  await expect(keyRow.getByText("Disabled", { exact: true })).toBeVisible();
  await expect(keyRow.getByRole("button", { name: `Revoke ${apiKeyName}`, exact: true })).toHaveCount(0);
});

test("Members have no API key rail entry or controls", async ({ operatorPage: page }) => {
  await page.goto("/settings/organization");
  const rail = page.getByRole("navigation", { name: "Settings categories" });
  await expect(rail).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(rail.getByRole("link", { name: "API keys", exact: true })).toHaveCount(0);
  await page.goto("/settings/api-keys");
  await expect(page.getByText(/Only organization Owners and Admins with a membership/)).toBeVisible();
  await expect(page.getByRole("button", { name: "New API key" })).toHaveCount(0);
});

test("a Platform Admin without membership sees the explanation", async ({ adminPage: page }) => {
  await page.goto("/settings/api-keys");
  await expect(page.getByText(/Only organization Owners and Admins with a membership/)).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(page.getByRole("button", { name: "New API key" })).toHaveCount(0);
});
