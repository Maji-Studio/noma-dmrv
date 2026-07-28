import { and, eq } from "drizzle-orm";
import { expect, test } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { certifierCredentials } from "@/db/schema/certification";
import { DEC_ORG_ID } from "@/db/org-defaults";

const PROVIDER = "isometric" as const;

test.describe("Isometric credentials self-service", () => {
  test("an organization admin can configure and replace credentials", async ({
    orgAdminPage: page,
    seededData,
  }) => {
    // The shared dev org may already hold REAL sandbox credentials. Snapshot
    // the row and restore it afterwards so the test never destroys local state,
    // and remove it BEFORE the page loads so no page in this test ever calls
    // Isometric with real credentials (the mapping section fetches the project
    // catalog on load and again when credentials change).
    const { db, pool } = createDbConnection();
    const whereOrg = and(
      eq(certifierCredentials.organizationId, DEC_ORG_ID),
      eq(certifierCredentials.provider, PROVIDER),
    );
    const [original] = await db
      .select()
      .from(certifierCredentials)
      .where(whereOrg)
      .limit(1);

    try {
      if (original) {
        await db.delete(certifierCredentials).where(whereOrg);
      }
      // The settings page is a category rail plus one detail pane, so only the
      // selected section is mounted. `?section=` is the deep link.
      await page.goto(
        `/certification/settings?section=certifier&facility=${seededData.facility.id}`,
      );

      const certifierPane = page.locator("section").filter({
        has: page.getByRole("heading", { name: "Certifier", exact: true }),
      });

      await expect(certifierPane).toBeVisible();

      // The inputs are always on screen — there is no "add credentials" state
      // to click through first.
      await certifierPane
        .getByLabel("Access token")
        .fill("e2e-org-admin-access-4321");
      await certifierPane
        .getByLabel("Client secret")
        .fill("e2e-org-admin-client-secret");
      await certifierPane.getByRole("button", { name: "Save keys" }).click();

      // Saved state shows on the field itself rather than in a separate summary
      // row: the last four characters and when it was stored.
      await expect(certifierPane.getByText("Ends 4321", { exact: false })).toBeVisible();
      // No assertion on the project picker here: setting credentials refetches
      // the mapping payload, which calls the real Isometric API — with these
      // fake credentials that read fails, and asserting on its outcome would
      // make the test network-dependent. The credentials-then-link flow is
      // covered by the @live specs.

      // Replacing is typing over the mask, not removing and re-adding.
      await certifierPane
        .getByLabel("Access token")
        .fill("e2e-org-admin-access-9876");
      await certifierPane.getByRole("button", { name: "Save keys" }).click();

      await expect(certifierPane.getByText("Ends 9876", { exact: false })).toBeVisible();
    } finally {
      await db.delete(certifierCredentials).where(whereOrg);
      if (original) {
        await db.insert(certifierCredentials).values(original);
      }
      await pool.end();
    }
  });

  test("an organization member sees only the read-only registry state", async ({
    operatorPage: page,
    seededData,
  }) => {
    await page.goto(
      `/certification/settings?section=certifier&facility=${seededData.facility.id}`,
    );

    // The pane itself is visible to a member — it is where the connection state
    // is readable — but neither the keys form nor the link controls are.
    await expect(
      page.getByRole("heading", { name: "Certifier", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Access token")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Link Isometric project" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "This facility has no Isometric project link yet. Ask an admin to link one",
        { exact: false },
      ),
    ).toBeVisible();
  });
});
