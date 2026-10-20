/**
 * Settings, General: the organization's operating defaults (formerly Defaults).
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
    await page.goto(`/settings/general?facility=${seededData.facility.id}`);

    await expect(
      page.getByRole("heading", { name: "General", exact: true, level: 1 }),
    ).toBeVisible({ timeout: 30_000 });

    // Wait for hydration before touching a control. The form is server-rendered
    // (the `(app)` layout seeds its values, so there is no loading skeleton to
    // sit behind), and react-hook-form only records a change once its onChange
    // listener is attached — a `selectOption` that lands first is visible in the
    // DOM but never reaches form state, so Save would store the old value.
    // The sidebar facility name is the repo's usual hydration signal: it is
    // resolved client-side by FacilityProvider.
    await expect(
      page.locator("aside").getByText(seededData.facility.name, { exact: false }),
    ).toBeVisible({ timeout: 30_000 });

    // The system fallback, before this organization has chosen anything.
    await expect(page.getByLabel("Currency")).toHaveCount(0);

    // Order packaging is a segmented control (native radios).
    await page.getByText("Bagged", { exact: true }).click();
    await page.getByRole("button", { name: "Save defaults" }).click();

    await expect(page.getByText("Operating defaults saved.")).toBeVisible();

    // Survives a reload: the value is stored, not just held in the form.
    await page.reload();
    await expect(page.getByRole("radio", { name: "Bagged" })).toBeChecked();

    // And reaches the form it says it seeds. This is the assertion that would
    // catch the default being saved into a table nothing reads.
    // The orders list has no `?create=true` intent handler; the header button
    // is the only way in.
    await page.goto(`/orders?facility=${seededData.facility.id}`);
    await page.getByRole("button", { name: "New order" }).click();
    await expect(page.getByLabel("Packaging")).toHaveValue("bagged", {
      timeout: 30_000,
    });
    await expect(page.getByLabel("Currency")).toHaveCount(0);
  });

  test("a member reads the defaults without controls", async ({
    operatorPage: page,
  }) => {
    // Q15: every member opens General; only Owners and Admins change it.
    await page.goto("/settings/general");
    await expect(
      page.getByRole("heading", { name: "General", exact: true, level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("New facilities start with")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save defaults" })).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);

    // The retired route lands on General too.
    await page.goto("/settings/defaults");
    await expect(page).toHaveURL(/\/settings\/general/);
  });
});
