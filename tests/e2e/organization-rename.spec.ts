/**
 * Renaming the organization on Settings, General (#1277 wave 2, Q5 and Q6).
 * Each test seeds its own organization, so the shared DEC organization is
 * never renamed.
 */
import { expect, test } from "./fixtures";
import { createDirectAuthContext } from "./fixtures/auth-fixtures";
import { seedDedicatedOrg } from "./fixtures/dedicated-org";

test.describe("Organization rename", () => {
  test("an Admin renames the organization and the sidebar follows", async ({ browser, baseURL }) => {
    const fixture = await seedDedicatedOrg({ role: "admin", withRegistryKeys: false });
    let context: Awaited<ReturnType<typeof createDirectAuthContext>> | null = null;
    try {
      context = await createDirectAuthContext(browser, fixture.user, baseURL!);
      const page = await context.newPage();
      await page.goto("/settings/general");
      await expect(page.getByRole("heading", { name: "General", exact: true, level: 1 })).toBeVisible();
      await expect(page.getByText("Slug", { exact: true })).toHaveCount(0);

      const rename = page.getByRole("button", { name: "Rename organization" });
      await expect(rename).toHaveCount(0);
      const newName = `E2E Renamed ${Date.now()}`;
      await page.getByRole("textbox", { name: "Name" }).fill(newName);
      await rename.click();

      await expect(page.getByText(`Organization renamed to ${newName}.`)).toBeVisible();
      await expect(rename).toHaveCount(0);
      await expect(page.getByRole("navigation").getByText(newName).first()).toBeVisible();
    } finally {
      try {
        await context?.close();
      } finally {
        await fixture.cleanup();
      }
    }
  });

  test("a Member reads the name without a Rename action", async ({ browser, baseURL }) => {
    const fixture = await seedDedicatedOrg({ role: "member", withRegistryKeys: false });
    let context: Awaited<ReturnType<typeof createDirectAuthContext>> | null = null;
    try {
      context = await createDirectAuthContext(browser, fixture.user, baseURL!);
      const page = await context.newPage();
      await page.goto("/settings/general");
      await expect(page.getByRole("heading", { name: "General", exact: true, level: 1 })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Name" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Rename organization" })).toHaveCount(0);
      await expect(page.getByText("Slug", { exact: true })).toHaveCount(0);
    } finally {
      try {
        await context?.close();
      } finally {
        await fixture.cleanup();
      }
    }
  });
});
