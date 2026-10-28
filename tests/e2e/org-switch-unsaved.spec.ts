/**
 * Switching organization from the sidebar asks about unsaved Settings changes
 * before the session moves (#1364): Keep editing stays put with the edit,
 * Discard changes switches without the browser's own "Leave site?" prompt.
 */
import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { test as authTest, expect } from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";

const test = authTest.extend<{ secondOrganizationName: string }>({
  secondOrganizationName: async ({}, provide) => {
    const tag = crypto.randomUUID().slice(0, 8);
    const organization = {
      id: `e2e-unsaved-org-${tag}`,
      name: `E2E Unsaved Switch ${tag}`,
      slug: `e2e-unsaved-switch-${tag}`,
    };
    const { db, pool } = createDbConnection();
    try {
      await db.insert(schema.organizations).values(organization);
      await provide(organization.name);
    } finally {
      await db.delete(schema.organizations).where(eq(schema.organizations.id, organization.id));
      await pool.end();
    }
  },
});

test("an organization switch asks about unsaved changes first", async ({ adminPage: page, secondOrganizationName }) => {
  const nativePrompts: string[] = [];
  page.on("dialog", (dialog) => {
    nativePrompts.push(dialog.type());
    void dialog.dismiss();
  });

  await page.goto("/settings/general");
  const country = page.locator("main input:not([type=hidden]):not([type=checkbox]):not([type=radio])").first();
  await expect(country).toBeVisible({ timeout: 30_000 });
  await country.click();
  await country.press("End");
  await country.press("1");
  const edited = await country.inputValue();

  const openSwitcher = () => page.getByRole("button", { name: /Dark Earth Carbon/ }).first().click();
  const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });

  await openSwitcher();
  await page.getByRole("option", { name: secondOrganizationName }).click();
  await expect(discardDialog).toContainText("Switching organization discards them.");

  // Keep editing: still in the old organization, edit kept, switcher usable.
  await discardDialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(discardDialog).toHaveCount(0);
  await expect(country).toHaveValue(edited);
  await expect(page.getByRole("button", { name: /Switching/ })).toHaveCount(0);

  // Discard changes: the switch goes ahead, and the browser never asks a second time.
  await openSwitcher();
  await page.getByRole("option", { name: secondOrganizationName }).click();
  await discardDialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  expect(nativePrompts).toEqual([]);
});
