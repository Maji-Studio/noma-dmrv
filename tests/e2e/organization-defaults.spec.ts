/**
 * Settings → Defaults: the organization's operating defaults.
 *
 * Covers the two claims the surface makes that nothing else proves end to end:
 * a saved default survives a reload, and it reaches the form it says it seeds.
 * A default that saves but never shows up in a create form is the whole feature
 * failing quietly.
 */
import { eq } from "drizzle-orm";
import { expect, test } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { organizationSettings } from "@/db/schema/settings";
import { DEC_ORG_ID } from "@/db/org-defaults";

async function clearOrganizationSettings(): Promise<void> {
  const { db, pool } = createDbConnection();
  try {
    await db
      .delete(organizationSettings)
      .where(eq(organizationSettings.organizationId, DEC_ORG_ID));
  } finally {
    await pool.end();
  }
}

test.describe("Organization operating defaults", () => {
  test.afterEach(clearOrganizationSettings);

  test("an org admin saves a default and a new order starts with it", async ({
    orgAdminPage: page,
    seededData,
  }) => {
    await clearOrganizationSettings();
    await page.goto("/settings/defaults");

    await expect(
      page.getByRole("heading", { name: "Defaults", exact: true, level: 1 }),
    ).toBeVisible({ timeout: 30_000 });

    // The system fallback, before this organization has chosen anything.
    const currency = page.getByLabel("Currency");
    await expect(currency).toHaveValue("TZS");

    await currency.selectOption("KES");
    await page.getByLabel("Order packaging").selectOption("bagged");
    await page.getByRole("button", { name: "Save defaults" }).click();

    await expect(page.getByText("Operating defaults saved.")).toBeVisible();

    // Survives a reload: the value is stored, not just held in the form.
    await page.reload();
    await expect(page.getByLabel("Currency")).toHaveValue("KES");
    await expect(page.getByLabel("Order packaging")).toHaveValue("bagged");

    // And reaches the form it says it seeds. This is the assertion that would
    // catch the default being saved into a table nothing reads.
    // The orders list has no `?create=true` intent handler; the header button
    // is the only way in.
    await page.goto(`/orders?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New Order" }).click();
    await expect(page.getByLabel("Currency")).toHaveValue("KES", {
      timeout: 30_000,
    });
    await expect(page.getByLabel("Packaging")).toHaveValue("bagged");
  });

  test("a member cannot reach the defaults route", async ({
    operatorPage: page,
  }) => {
    // The rail does not offer it, and the route itself refuses — a member
    // landing on a form they cannot submit is worse than a 404.
    await page.goto("/settings/organization");
    await expect(
      page.getByRole("navigation", { name: "Settings categories" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("link", { name: "Defaults", exact: true }),
    ).toHaveCount(0);

    await page.goto("/settings/defaults");
    await expect(page.getByLabel("Currency")).toHaveCount(0);
  });
});
