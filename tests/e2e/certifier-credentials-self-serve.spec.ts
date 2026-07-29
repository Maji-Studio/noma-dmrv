import { and, eq } from "drizzle-orm";
import { expect, test } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { certifierCredentials } from "@/db/schema/certification";
import { DEC_ORG_ID, DEC_ORG_NAME } from "@/db/org-defaults";
import { encryptSecret } from "@/lib/crypto/secrets";

const PROVIDER = "isometric" as const;
const CLIENT_SECRET = "e2e-org-admin-client-secret";

test.describe("Isometric credentials self-service", () => {
  test("the admin directory reflects configured and replaced credentials", async ({
    adminPage: page,
  }) => {
    // The shared dev org may already hold REAL sandbox credentials. Snapshot
    // the row and restore it afterwards so the test never destroys local state.
    // Seed through the database, then inspect the Platform Admin directory:
    // that surface exercises the same credential status/form UI without
    // mounting the facility project picker or making a real Isometric request.
    // The server save/rotation behavior is covered hermetically in
    // tests/certifier-credentials-fn.test.ts.
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
      await db
        .insert(certifierCredentials)
        .values({
          organizationId: DEC_ORG_ID,
          provider: PROVIDER,
          accessTokenEncrypted: encryptSecret("e2e-org-admin-access-4321"),
          clientSecretEncrypted: encryptSecret(CLIENT_SECRET),
        })
        .onConflictDoUpdate({
          target: [
            certifierCredentials.organizationId,
            certifierCredentials.provider,
          ],
          set: {
            accessTokenEncrypted: encryptSecret("e2e-org-admin-access-4321"),
            clientSecretEncrypted: encryptSecret(CLIENT_SECRET),
            updatedAt: new Date(),
          },
        });

      await page.goto("/admin/organizations");
      const organization = page
        .getByRole("listitem")
        .filter({ hasText: DEC_ORG_NAME });
      await expect(organization).toBeVisible();
      await expect(
        organization.getByText("Ends 4321", { exact: false }),
      ).toBeVisible();
      await expect(organization.getByLabel("Access token")).not.toHaveValue(
        "e2e-org-admin-access-4321",
      );

      await db
        .update(certifierCredentials)
        .set({
          accessTokenEncrypted: encryptSecret("e2e-org-admin-access-9876"),
          updatedAt: new Date(),
        })
        .where(whereOrg);
      await page.reload();

      await expect(
        page
          .getByRole("listitem")
          .filter({ hasText: DEC_ORG_NAME })
          .getByText("Ends 9876", { exact: false }),
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
        "This facility has no Isometric project link. Ask an Admin to link one",
        { exact: false },
      ),
    ).toBeVisible();
  });
});
