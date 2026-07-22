import * as crypto from "crypto";
import { eq } from "drizzle-orm";
import type { Locator, Page } from "@playwright/test";
import * as schema from "../../src/db/schema";
import { test as authTest, expect } from "./fixtures/auth-fixtures";
import { createDbConnection } from "./fixtures/db";
import { enterDefaultOrganization } from "./fixtures/organization-helpers";

const ORGANIZATION_NAME = "Dark Earth Carbon";
const INVITEE_EMAIL = "org-e2e-invitee@example.com";

const test = authTest.extend<{ secondOrganizationName: string }>({
  secondOrganizationName: async ({}, provide) => {
    const tag = crypto.randomUUID().slice(0, 8);
    const organization = {
      id: `e2e-switcher-org-${tag}`,
      name: `E2E Switcher Organization ${tag}`,
      slug: `e2e-switcher-organization-${tag}`,
    };
    const { db, pool } = createDbConnection();

    try {
      await db.insert(schema.organizations).values(organization);
      await provide(organization.name);
    } finally {
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, organization.id));
      await pool.end();
    }
  },
});

function sectionWithHeading(page: Page, heading: string): Locator {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: heading, exact: true }),
  });
}

async function openOrganizationSettings(page: Page): Promise<void> {
  await enterDefaultOrganization(page);
  await page.goto("/settings/organization");
  // First render may hit a dev-server compile of this route; allow extra time.
  await expect(
    page.getByRole("heading", { name: "Organization", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

async function revokeInviteIfPresent(
  page: Page,
  pendingSection: Locator,
): Promise<void> {
  const invitation = pendingSection
    .getByRole("listitem")
    .filter({ hasText: INVITEE_EMAIL })
    .first();

  if ((await invitation.count()) === 0) {
    return;
  }

  await invitation.getByRole("button", { name: "Revoke" }).click();
  const dialog = page.getByRole("dialog", { name: "Revoke invitation" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(invitation).toHaveCount(0);
}

test.describe("Organization foundation UI", () => {
  test("organization settings renders members and an empty invitation state", async ({
    adminPage,
  }) => {
    const page = adminPage;
    await openOrganizationSettings(page);

    const membersSection = sectionWithHeading(page, "Members");
    const memberRows = membersSection.getByRole("listitem");
    const ownerRoleSelect = membersSection
      .locator('select[aria-label^="Role for "]')
      .filter({ has: page.locator('option[value="owner"]:checked') });

    await expect(memberRows.first()).toBeVisible();
    await expect(ownerRoleSelect.first()).toHaveValue("owner");

    const pendingSection = sectionWithHeading(page, "Pending invitations");
    await revokeInviteIfPresent(page, pendingSection);
    await expect(
      pendingSection.getByText("No pending invitations", { exact: true }),
    ).toBeVisible();
  });

  test("invites a member, exposes the accept link, and revokes the invitation", async ({
    adminPage,
  }) => {
    const page = adminPage;
    await openOrganizationSettings(page);

    const pendingSection = sectionWithHeading(page, "Pending invitations");
    await revokeInviteIfPresent(page, pendingSection);

    const inviteSection = sectionWithHeading(page, "Invite a member");
    await inviteSection.getByLabel("Email").fill(INVITEE_EMAIL);
    await inviteSection.getByLabel("Role").selectOption("member");
    await inviteSection
      .getByRole("button", { name: "Send invitation" })
      .click();

    const shareLinkInput = inviteSection
      .getByText("Share this link with the invitee", { exact: true })
      .locator("..")
      .getByRole("textbox");
    const pendingInvitation = pendingSection
      .getByRole("listitem")
      .filter({ hasText: INVITEE_EMAIL });

    try {
      await expect(shareLinkInput).toBeVisible();
      await expect(shareLinkInput).toHaveValue(
        /^https?:\/\/.+\/accept-invitation\/.+/,
      );
      await expect(pendingInvitation).toBeVisible();
      // Role text is lowercase in the DOM; the uppercase styling is CSS-only.
      await expect(pendingInvitation).toContainText(/member/i);
    } finally {
      await page.waitForLoadState("networkidle");
      await revokeInviteIfPresent(page, pendingSection);
    }

    await expect(pendingInvitation).toHaveCount(0);
  });

  test("admin directory lists the seeded organization and enters its dashboard", async ({
    adminPage,
  }) => {
    const page = adminPage;
    await page.goto("/admin/organizations");

    const organizationsSection = sectionWithHeading(page, "Organizations");
    const organization = organizationsSection
      .getByRole("listitem")
      .filter({ hasText: ORGANIZATION_NAME });
    await expect(organization).toBeVisible();
    await expect(organization).toContainText(/\d+ members?/);

    const createSection = sectionWithHeading(page, "Create organization");
    await expect(
      createSection.getByRole("button", { name: "Create organization" }),
    ).toBeEnabled();

    await organization.getByRole("button", { name: "Enter" }).click();
    await expect(page).toHaveURL(/\/dashboard(?:[/?#]|$)/);
  });

  test("single-organization member sees the active organization as a sidebar link", async ({
    orgAdminPage,
  }) => {
    const page = orgAdminPage;
    await page.goto("/dashboard");

    const sidebar = page.getByRole("complementary");
    const orgLink = sidebar
      .locator('a[href="/dashboard"]')
      .filter({ hasText: ORGANIZATION_NAME });

    await expect(orgLink).toBeVisible();
    await expect(
      orgLink.getByText(ORGANIZATION_NAME, { exact: true }),
    ).toBeVisible();
    await expect(
      sidebar.locator('button[aria-haspopup="listbox"]'),
    ).toHaveCount(0);
  });

  test("platform admin sees the switcher when multiple organizations exist", async ({
    adminPage,
    secondOrganizationName,
  }) => {
    const page = adminPage;
    await enterDefaultOrganization(page);

    const sidebar = page.getByRole("complementary");
    const orgSwitcher = sidebar
      .locator('button[aria-haspopup="listbox"]')
      .filter({ hasText: ORGANIZATION_NAME });

    await expect(orgSwitcher).toBeVisible();
    // The switcher pairs a decorative BrandMark initial ("D") with the org
    // name span, so the button's full text is "DDark Earth Carbon". Assert the
    // name node itself renders exactly once rather than the whole button text.
    await expect(
      orgSwitcher.getByText(ORGANIZATION_NAME, { exact: true }),
    ).toBeVisible();

    await orgSwitcher.click();
    await expect(
      page.getByRole("option", { name: secondOrganizationName, exact: true }),
    ).toBeVisible();
  });
});
