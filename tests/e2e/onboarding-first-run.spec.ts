/**
 * First-run onboarding — the wizard and the getting-started guide, driven as a
 * brand-new org Owner (the plan's target persona).
 *
 * The shared seeded org already has facilities, so the wizard would never
 * auto-open there. This spec provisions its own empty org + owner user
 * (mirroring the auth-fixtures seeding idiom), signs in through the auth API,
 * and walks: auto-opened wizard → facility → reactor → registry → guide spine
 * → collapse/expand → supplier CTA round-trip → self-clearing step state.
 */
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { expect, test } from "./fixtures";
import { createDirectAuthContext } from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";
import * as schema from "@/db/schema";
import { encryptSecret } from "@/lib/crypto/secrets";

const RUN_TAG = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_ID = `e2e-onboarding-org-${RUN_TAG}`;
const ORG_NAME = `E2E Onboarding Org ${RUN_TAG}`;
const USER_ID = `e2e-onboarding-owner-${RUN_TAG}`;
const PROVIDER = "isometric" as const;
const OWNER = {
  id: USER_ID,
  email: `test-onboarding-owner-${RUN_TAG}@e2e.local`,
  name: "E2E Onboarding Owner",
  role: "user" as const,
  password: "TestPassword123!",
};

test.describe("First-run onboarding", () => {
  test("wizard auto-opens for a fresh org and the guide walks the chain", async ({
    adminPage,
    browser,
    baseURL,
  }) => {
    // One long journey across many first-compile routes on a dev server.
    test.setTimeout(240_000);
    const { db, pool } = createDbConnection();

    await db.transaction(async (tx) => {
      await tx.insert(schema.organizations).values({
        id: ORG_ID,
        name: ORG_NAME,
        slug: `e2e-onboarding-${RUN_TAG}`,
      });
      await tx.insert(schema.users).values({
        id: USER_ID,
        email: OWNER.email,
        name: OWNER.name,
        role: "user",
        emailVerified: true,
      });
      await tx.insert(schema.accounts).values({
        id: `e2e-onboarding-account-${RUN_TAG}`,
        userId: USER_ID,
        accountId: `e2e-onboarding-account-${RUN_TAG}`,
        providerId: "credential",
        password: await hashPassword(OWNER.password),
      });
      await tx.insert(schema.members).values({
        id: `e2e-onboarding-member-${RUN_TAG}`,
        organizationId: ORG_ID,
        userId: USER_ID,
        role: "owner",
      });
    });

    // Everything after seeding sits inside try/finally — an API sign-in
    // failure (e.g. auth rate limiting) must still tear the seeded org down,
    // or reruns leak orgs into the shared dev DB.
    let context: Awaited<ReturnType<typeof createDirectAuthContext>> | null =
      null;
    try {
      context = await createDirectAuthContext(browser, OWNER, baseURL!);
      const page = await context.newPage();
      // 1. The wizard auto-opens on a zero-facility org.
      await page.goto("/dashboard");
      const wizard = page.getByRole("dialog", { name: "Set up your facility" });
      await expect(wizard).toBeVisible();
      await expect(wizard.getByText("Welcome")).toBeVisible();

      // 2. Facility step — the real facility form. With a single available
      // tier the durability field renders as read-only 1000-year info (#348).
      await wizard.getByRole("button", { name: "Get started" }).click();
      await expect(wizard.getByLabel(/facility name/i)).toBeVisible();
      await expect(wizard.getByTestId("durability-tier-info")).toBeVisible();
      await expect(
        wizard.getByText("1000-year durability"),
      ).toBeVisible();
      await wizard.getByLabel(/facility name/i).fill("CU Test Facility");
      await wizard.getByLabel(/country/i).fill("Tanzania");
      await wizard
        .getByLabel(/timezone/i)
        .selectOption({ index: 1 });
      await wizard.getByRole("button", { name: "Add facility" }).click();

      // 3. Reactor step.
      await expect(
        wizard.getByRole("button", { name: "Register reactor" }),
      ).toBeVisible();
      await wizard.getByLabel(/identifier/i).fill("CU-R1");
      await wizard.getByLabel(/reactor type/i).selectOption({ index: 1 });
      await wizard
        .getByRole("button", { name: "Register reactor", exact: true })
        .first()
        .click();

      // 4. Registry step — picker cards + self-serve credentials on the NEW org.
      await expect(wizard.getByText("Puro.earth")).toBeVisible();
      await expect(wizard.getByText("CSI")).toBeVisible();
      await expect(wizard.getByText(/coming soon/i).first()).toBeVisible();
      await expect(wizard.getByLabel("Access token")).toBeVisible();
      await expect(wizard.getByLabel("Client secret")).toBeVisible();

      // Credential writes verify against live Isometric. Keep this PR-shard
      // journey hermetic: seed the encrypted row directly, then exercise the
      // same status UI through the Platform Admin directory, which never mounts
      // the facility project picker or calls Isometric.
      await db.insert(schema.certifierCredentials).values({
        organizationId: ORG_ID,
        provider: PROVIDER,
        accessTokenEncrypted: encryptSecret("e2e-onboarding-access-9999"),
        clientSecretEncrypted: encryptSecret("e2e-onboarding-client-secret"),
      });
      await adminPage.goto("/admin/organizations");
      const organization = adminPage
        .getByRole("listitem")
        .filter({ hasText: ORG_NAME });
      await expect(organization).toBeVisible();
      await expect(
        organization.getByText("Ends 9999", { exact: false }),
      ).toBeVisible();

      // 5. Finish → the guide takes over the dashboard body.
      await wizard.getByRole("button", { name: "Finish" }).click();
      await expect(wizard).not.toBeVisible();
      const guide = page.getByRole("region", { name: "Getting started" });
      await expect(guide).toBeVisible();
      await expect(
        guide.getByText("Build your first traceability chain"),
      ).toBeVisible();
      // Credentials alone don't complete the registry step — done-ness needs
      // the facility↔project LINK, which fake keys can't produce. Honest
      // derivation: 2 of 7, registry stays the single active step.
      await expect(guide.getByText("2 of 7 done")).toBeVisible();
      await expect(
        guide.getByRole("button", { name: "Connect registry" }),
      ).toBeVisible();

      // 6. Collapse to the strip (real dashboard renders), expand back.
      await guide.getByRole("button", { name: "Hide setup guide" }).click();
      await expect(page.getByText(/Setup · 2\/7/)).toBeVisible();
      await expect(page.getByTestId("dashboard-kpis")).toBeVisible();
      await page.getByRole("button", { name: "Show guide" }).click();
      await expect(guide).toBeVisible();

      // 7. Supplier round-trip via its upcoming-step link: create sheet
      // deep-link, then the step self-clears on client-side dashboard return.
      await guide.getByRole("link", { name: "Add supplier" }).click();
      await expect(page).toHaveURL(/\/suppliers/);
      const sheet = page.getByRole("dialog", { name: "Create Supplier" });
      await expect(sheet.getByLabel(/supplier name|^name/i)).toBeVisible();
      await sheet.getByLabel(/supplier name|^name/i).fill("CU Test Supplier");
      // Suppliers require at least one committed source location: open the
      // nested dialog, fill its required fields (country and GPS position),
      // and commit it before returning to the still-open supplier sheet.
      await sheet.getByRole("button", { name: "Add Location" }).click();
      const locationDialog = page.getByRole("dialog", {
        name: "Add Location",
      });
      await expect(locationDialog).toBeVisible();
      const locationName = locationDialog.getByLabel("Location name");
      await expect(locationName).toBeVisible();
      await locationName.fill("CU Source Site");
      await locationDialog.getByLabel("Country").fill("Tanzania");
      const lat = locationDialog.getByRole("spinbutton", {
        name: /^GPS latitude(?: Required)?$/,
      });
      const lng = locationDialog.getByRole("spinbutton", {
        name: /^GPS longitude(?: Required)?$/,
      });
      await expect(lat).toBeVisible();
      await lat.fill("-6.163");
      await lng.fill("35.7516");
      await locationDialog
        .getByRole("button", { name: "Add Location" })
        .click();
      await expect(locationDialog).not.toBeVisible();
      await expect(sheet).toBeVisible();
      // Dialog committed → exactly one pending location row in the supplier sheet.
      await expect(sheet.getByText("CU Source Site")).toBeVisible();
      await sheet.getByRole("button", { name: "Create Supplier" }).click();
      // The sheet closes only after the create mutation succeeds — wait for it
      // so the dashboard return can't race the in-flight write.
      await expect(sheet).not.toBeVisible();
      await page
        .getByRole("link", { name: "Dashboard", exact: true })
        .click();
      await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
      await expect(guide.getByText("3 of 7 done")).toBeVisible();

      // 8. With a facility present the wizard never auto-opens again.
      await page.reload();
      await expect(guide).toBeVisible();
      await expect(
        page.getByRole("dialog", { name: "Set up your facility" }),
      ).not.toBeVisible();
    } finally {
      // The harness may have already torn the context down on test timeout.
      await context?.close().catch(() => {});
      const orgTables = [
        schema.certifierCredentials,
        schema.supplierLocations,
        schema.suppliers,
        schema.reactors,
        schema.facilities,
        schema.members,
      ] as const;
      for (const table of orgTables) {
        await db.delete(table).where(eq(table.organizationId, ORG_ID));
      }
      await db
        .delete(schema.sessions)
        .where(eq(schema.sessions.userId, USER_ID));
      await db
        .delete(schema.accounts)
        .where(eq(schema.accounts.userId, USER_ID));
      await db.delete(schema.users).where(eq(schema.users.id, USER_ID));
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, ORG_ID));
      await pool.end();
    }
  });
});
