import { and, eq } from "drizzle-orm";
import { expect, test } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { certifierCredentials } from "@/db/schema/certification";
import { DEC_ORG_ID } from "@/db/org-defaults";

const PROVIDER = "isometric" as const;

test.describe("Isometric credentials self-service", () => {
  test("an organization admin can configure and remove credentials", async ({
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
      await page.goto(
        `/certification/settings?facility=${seededData.facility.id}`,
      );

      const credentialsSection = page.locator("section").filter({
        has: page.getByRole("heading", {
          name: "Registry credentials — Isometric",
          exact: true,
        }),
      });

      await expect(credentialsSection).toBeVisible();

      await credentialsSection
        .getByLabel("Access token")
        .fill("e2e-org-admin-access-4321");
      await credentialsSection
        .getByLabel("Client secret")
        .fill("e2e-org-admin-client-secret");
      await credentialsSection
        .getByRole("button", { name: /Set credentials|Replace credentials/ })
        .click();

      await expect(
        credentialsSection.getByText("Access token …4321"),
      ).toBeVisible();
      // No assertion on the project picker here: setting credentials refetches
      // the mapping payload, which calls the real Isometric API — with these
      // fake credentials that read fails, and asserting on its outcome would
      // make the test network-dependent. The credentials-then-link flow is
      // covered by the @live specs.

      await credentialsSection.getByRole("button", { name: "Remove" }).click();
      const removeDialog = page.getByRole("dialog", {
        name: "Remove Isometric credentials",
      });
      await removeDialog.getByRole("button", { name: "Delete" }).click();

      await expect(
        credentialsSection.getByText("Isometric credentials not configured"),
      ).toBeVisible();
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
      `/certification/settings?facility=${seededData.facility.id}`,
    );

    await expect(
      page.getByRole("heading", {
        name: "Registry credentials — Isometric",
        exact: true,
      }),
    ).toHaveCount(0);
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
