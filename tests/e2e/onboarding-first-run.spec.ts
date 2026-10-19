/** First-run dashboard guide for a fresh organization, using normal create surfaces. */
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { expect, test } from "./fixtures";
import { createDirectAuthContext } from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";
import * as schema from "@/db/schema";
import { CERTIFIER_VERIFICATION_MESSAGES } from "@/lib/certification/certifier-credentials-verification";
import {
  E2E_CERTIFIER_CLIENT_SECRET,
  maskedCertifierAccessToken,
} from "./fixtures/certifier-credentials";
import { saveCertifierKeysInAdminDirectory } from "./fixtures/certifier-credentials-ui";

const RUN_TAG = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ORG_ID = `e2e-onboarding-org-${RUN_TAG}`;
const ORG_NAME = `E2E Onboarding Org ${RUN_TAG}`;
const USER_ID = `e2e-onboarding-owner-${RUN_TAG}`;
const ACCESS_TOKEN = "e2e-onboarding-access-9999";
const OWNER = {
  id: USER_ID,
  email: `test-onboarding-owner-${RUN_TAG}@e2e.local`,
  name: "E2E Onboarding Owner",
  role: "user" as const,
  password: "TestPassword123!",
};

test.describe("First-run onboarding", () => {
  test("the dashboard guide opens shared forms and advances after creation", async ({
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
        accountId: USER_ID,
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
      await page.goto("/dashboard");
      const guide = page.getByRole("region", { name: "Getting started" });
      await expect(guide).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(guide.getByText("0 of 7 done")).toBeVisible();
      const activeStep = guide.locator('[aria-current="step"]');
      await expect(activeStep.getByRole("button", { name: "Add facility" })).toBeVisible();
      await expect(guide.getByRole("button", { name: "Register reactor" })).toBeDisabled();
      await expect(guide.getByRole("button", { name: "Connect registry" })).toBeDisabled();

      await guide.getByRole("button", { name: "Add facility" }).click();
      const facilitySheet = page.getByRole("dialog", { name: "Create facility" });
      await expect(facilitySheet.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
      const tierGroup = facilitySheet.getByRole("radiogroup", { name: "Durability tier" });
      await expect(tierGroup.getByRole("radio", { name: /1000-year/i })).toHaveAttribute("aria-checked", "true");
      await expect(tierGroup.getByRole("radio", { name: /200-year/i })).toHaveAttribute("aria-disabled", "true");
      await facilitySheet.getByRole("textbox", { name: /facility name/i }).fill(`E2E Onboarding Facility ${RUN_TAG}`);
      await facilitySheet.getByRole("textbox", { name: /^country/i }).fill("Tanzania");
      await page.locator("#gps-latitude").fill("-8.3");
      await page.locator("#gps-longitude").fill("35.3");
      await facilitySheet.getByRole("combobox", { name: /timezone/i }).fill("Nairobi");
      await page.getByRole("option", { name: "Africa/Nairobi (UTC+3)" }).click();
      await facilitySheet.getByRole("button", { name: "Create facility", exact: true }).click();
      await expect(facilitySheet).not.toBeVisible();
      await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
      await expect(guide.getByText("1 of 7 done")).toBeVisible();
      await expect(activeStep.getByRole("button", { name: "Register reactor" })).toBeVisible();

      await guide.getByRole("button", { name: "Register reactor" }).click();
      const reactorSheet = page.getByRole("dialog", { name: "Create reactor" });
      await reactorSheet.getByRole("textbox", { name: /^identifier/i }).fill(`E2E Onboarding Reactor ${RUN_TAG}`);
      await reactorSheet.getByRole("combobox", { name: /reactor type/i }).selectOption({ index: 1 });
      await reactorSheet.getByRole("button", { name: "Create reactor", exact: true }).click();
      await expect(reactorSheet).not.toBeVisible();
      await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
      await expect(guide.getByText("2 of 7 done")).toBeVisible();
      await expect(activeStep.getByRole("button", { name: "Connect registry" })).toBeVisible();

      await guide.getByRole("button", { name: "Connect registry" }).click();
      const registry = page.getByRole("dialog", { name: "Connect your registry", exact: true });
      await expect(registry.getByText("Puro.earth")).toBeVisible();
      await expect(registry.getByText("CSI")).toBeVisible();
      await expect(registry.getByLabel("Access token")).toBeVisible();
      await expect(registry.getByLabel("Client secret")).toBeVisible();
      await registry.getByLabel("Access token").fill("e2e-unsaved-token");
      await page.keyboard.press("Escape");
      const discard = page.getByRole("dialog", { name: "Discard unsaved changes?" });
      await expect(discard).toBeVisible();
      await discard.getByRole("button", { name: "Keep editing" }).click();
      await expect(registry.getByLabel("Access token")).toHaveValue("e2e-unsaved-token");
      await registry.getByRole("button", { name: "Close", exact: true }).click();
      await discard.getByRole("button", { name: "Discard changes" }).click();
      await expect(registry).not.toBeVisible();
      await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);

      // Save the keys through the Platform Admin directory so the app server
      // encrypts them (#1010). The fixture secret cannot form an HTTP header,
      // so the post-save connection check fails offline and the journey stays
      // hermetic. Then reload to read the stored status back.
      const keys = await saveCertifierKeysInAdminDirectory(adminPage, ORG_NAME, {
        accessToken: ACCESS_TOKEN,
        clientSecret: E2E_CERTIFIER_CLIENT_SECRET,
      });
      await expect(
        keys.getByText(CERTIFIER_VERIFICATION_MESSAGES.network, { exact: true }),
      ).toBeVisible();
      await adminPage.reload();
      const organization = adminPage
        .getByRole("listitem")
        .filter({ hasText: ORG_NAME });
      await expect(organization).toBeVisible();
      await expect(organization.getByText("Keys saved")).toBeVisible();
      await organization.getByRole("button", { name: "Isometric keys" }).click();
      await expect(
        adminPage.getByRole("dialog").getByText(maskedCertifierAccessToken(ACCESS_TOKEN), { exact: false }),
      ).toBeVisible();

      await expect(guide.getByText("Build your first traceability chain")).toBeVisible();
      // Credentials alone don't complete the registry step — done-ness needs
      // the facility↔project LINK, which fake keys can't produce. Honest
      // derivation: 2 of 7, registry stays the single active step.
      await expect(guide.getByText("2 of 7 done")).toBeVisible();
      await expect(
        guide.getByRole("button", { name: "Connect registry" }),
      ).toBeVisible();

      // 6. Collapse to the strip (real dashboard renders), expand back.
      await guide.getByRole("button", { name: "Hide setup guide" }).click();
      await expect(page.getByText(/Setup, 2 of 7/)).toBeVisible();
      await expect(page.getByTestId("dashboard-kpis")).toBeVisible();
      await page.getByRole("button", { name: "Show guide" }).click();
      await expect(guide).toBeVisible();

      // Supplier round-trip via its secondary action: create sheet
      // deep-link, then the step self-clears on client-side dashboard return.
      await guide.getByRole("button", { name: "Add supplier" }).click();
      await expect(page).toHaveURL(/\/suppliers/);
      const sheet = page.getByRole("dialog", { name: "Create supplier" });
      await expect(sheet.getByLabel(/supplier name|^name/i)).toBeVisible();
      await sheet.getByLabel(/supplier name|^name/i).fill(`E2E Onboarding Supplier ${RUN_TAG}`);
      // Suppliers require at least one committed source location: open the
      // nested dialog, fill its required fields (country and GPS position),
      // and commit it before returning to the still-open supplier sheet.
      await sheet.getByRole("button", { name: "Add location" }).click();
      const locationDialog = page.getByRole("dialog", {
        name: "Add location",
      });
      await expect(locationDialog).toBeVisible();
      // By role: the field's ⓘ button is named "More about Location name".
      const locationName = locationDialog.getByRole("textbox", {
        name: "Location name",
      });
      await expect(locationName).toBeVisible();
      await locationName.fill("E2E Onboarding Source Site");
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
        .getByRole("button", { name: "Add location" })
        .click();
      await expect(locationDialog).not.toBeVisible();
      await expect(sheet).toBeVisible();
      // Dialog committed → exactly one pending location row in the supplier sheet.
      await expect(sheet.getByText("E2E Onboarding Source Site")).toBeVisible();
      await sheet.getByRole("button", { name: "Create supplier" }).click();
      // The sheet closes only after the create mutation succeeds — wait for it
      // so the dashboard return can't race the in-flight write.
      await expect(sheet).not.toBeVisible();
      await page
        .getByRole("link", { name: "Dashboard", exact: true })
        .click();
      await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
      await expect(guide.getByText("3 of 7 done")).toBeVisible();

      // Returning to the dashboard keeps the guide visible without opening a dialog.
      await page.reload();
      await expect(guide).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
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
