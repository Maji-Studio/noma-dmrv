import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { certifierCredentials } from "@/db/schema/certification";
import { organizations } from "@/db/schema/auth";
import {
  E2E_CERTIFIER_ACCESS_TOKEN,
  E2E_CERTIFIER_CLIENT_SECRET,
  E2E_CERTIFIER_ROTATED_ACCESS_TOKEN,
} from "./fixtures/certifier-credentials";
import { certifierKeyInput } from "./fixtures/certifier-credentials-ui";
import { CERTIFIER_VERIFICATION_MESSAGES } from "@/lib/certification/certifier-credentials-verification";

test.describe("Isometric credentials self-service", () => {
  test("the admin directory reflects configured and replaced credentials", async ({
    adminPage: page,
  }) => {
    // Never replace the shared org's keys, even temporarily: @live specs can
    // run alongside this file. Only the app server encrypts the new org's keys.
    const tag = randomUUID();
    const organizationId = `e2e-credentials-org-${tag}`;
    const organizationName = `E2E Credentials Org ${tag}`;
    const { db, pool } = createDbConnection();

    try {
      await db.insert(organizations).values({
        id: organizationId,
        name: organizationName,
        slug: `e2e-credentials-${tag}`,
      });

      await page.goto("/admin/organizations");
      const organization = page
        .getByRole("listitem")
        .filter({ hasText: organizationName });
      await expect(organization).toBeVisible();
      await expect(organization.getByText("No keys", { exact: true })).toBeVisible();
      await organization.getByRole("button", { name: "Isometric keys" }).click();
      const keys = page.getByRole("dialog");
      await certifierKeyInput(keys, "Access token").fill(E2E_CERTIFIER_ACCESS_TOKEN);
      await certifierKeyInput(keys, "Client secret").fill(E2E_CERTIFIER_CLIENT_SECRET);
      await keys.getByRole("button", { name: "Save and test connection" }).click();
      await expect(keys.getByRole("button", { name: /^Replace/ })).toHaveCount(2);
      // The fixture secret cannot form an HTTP header, so the check fails
      // offline as a network error after the keys are stored.
      await expect(keys.getByText(CERTIFIER_VERIFICATION_MESSAGES.network, { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(keys).not.toBeVisible();
      await page.reload();
      await expect(organization.getByText("Keys saved")).toBeVisible();
      // The keys live in a modal; a saved key shows only its last characters
      // and a Replace action, never an input holding the secret.
      await organization.getByRole("button", { name: "Isometric keys" }).click();
      await expect(keys.getByText("••••4321", { exact: false })).toBeVisible();
      await expect(keys.getByText("••••••••", { exact: true })).toBeVisible();
      await expect(keys.getByRole("button", { name: "Save and test connection" })).toHaveCount(0);
      await expect(keys.locator('input[type="password"]')).toHaveCount(0);
      await expect(keys.getByRole("button", { name: /^Replace/ })).toHaveCount(2);

      await keys.getByRole("button", { name: "Replace access token", exact: true }).click();
      await certifierKeyInput(keys, "Access token").fill(E2E_CERTIFIER_ROTATED_ACCESS_TOKEN);
      await keys.getByRole("button", { name: "Save and test connection" }).click();
      await expect(keys.getByText("••••9876", { exact: false })).toBeVisible();
      await expect(keys.getByRole("button", { name: /^Replace/ })).toHaveCount(2);
      await page.keyboard.press("Escape");
      await expect(keys).not.toBeVisible();
      await page.reload();

      await page
        .getByRole("listitem")
        .filter({ hasText: organizationName })
        .getByRole("button", { name: "Isometric keys" })
        .click();
      await expect(
        page.getByRole("dialog").getByText("••••9876", { exact: false }),
      ).toBeVisible();
    } finally {
      // One transaction: the credentials row has no cascade, so it goes
      // first, and a failure leaves neither row half-removed.
      try {
        await db.transaction(async (tx) => {
          await tx.delete(certifierCredentials).where(eq(certifierCredentials.organizationId, organizationId));
          await tx.delete(organizations).where(eq(organizations.id, organizationId));
        });
      } finally {
        await pool.end();
      }
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
    await expect(page.getByRole("button", { name: "Save and test connection" })).toHaveCount(0);
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
