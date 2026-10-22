/**
 * Platform Organizations (#1373): pick an organization, switch into it, see the
 * current one, and create organizations without a slug. Every organization
 * here is created for the test and removed after; the shared Dark Earth Carbon
 * organization is only switched back to, never changed.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { expect, test } from "./fixtures";
import { createDbConnection } from "./fixtures/db";
import { seedDedicatedOrg } from "./fixtures/dedicated-org";
import { enterDefaultOrganization } from "./fixtures/organization-helpers";
import * as schema from "@/db/schema";
import { organizationSlugBase } from "@/lib/organizations/organization-slug";

const DASHBOARD_URL = /\/dashboard(?:[/?#]|$)/;

test.describe("Platform Organizations", () => {
  test("switches into another organization and says when you are already in one", async ({ adminPage: page }) => {
    // Two full-page switches (in, then back to the shared organization).
    test.slow();
    const fixture = await seedDedicatedOrg({ role: "admin", withRegistryKeys: false });
    try {
      await page.goto(`/admin/organizations?org=${fixture.organizationId}`);
      const panel = page.getByRole("article", { name: fixture.organizationName });
      await expect(panel.getByRole("region", { name: "Isometric keys" }).getByText("Missing", { exact: true })).toBeVisible();
      await expect(panel.getByText(`Switches you to ${fixture.organizationName}, then opens Settings, Members.`)).toBeVisible();

      const switchButton = panel.getByRole("button", { name: `Switch to ${fixture.organizationName}` });
      await switchButton.click();
      // Next dev can drop the first action after compiling a sibling route.
      await page.waitForURL(DASHBOARD_URL, { timeout: 5_000 }).catch(() => undefined);
      if (!DASHBOARD_URL.test(page.url())) await switchButton.click();
      await expect(page).toHaveURL(DASHBOARD_URL);
      await expect(page.getByText(`Now working in ${fixture.organizationName}.`)).toBeVisible();

      await page.goto(`/admin/organizations?org=${fixture.organizationId}`);
      const current = page.getByRole("article", { name: fixture.organizationName });
      await expect(current.getByText(`You're working in ${fixture.organizationName}.`)).toBeVisible();
      await expect(current.getByRole("button", { name: /^Switch to/ })).toHaveCount(0);
    } finally {
      await enterDefaultOrganization(page);
      await fixture.cleanup();
    }
  });

  test("creates organizations without a slug, inviting a first Admin who has no account", async ({ adminPage: page }) => {
    const tag = randomUUID().slice(0, 8);
    const memberOrgName = `E2E Platform Org ${tag}`;
    const invitedOrgName = `E2E Platform Invite ${tag}`;
    const fixture = await seedDedicatedOrg({ role: "member", withRegistryKeys: false });
    const { db, pool } = createDbConnection();
    try {
      await page.goto("/admin/organizations");
      await page.getByRole("navigation", { name: "Organizations" }).getByRole("button", { name: "New organization" }).click();
      const form = page.getByRole("form", { name: "New organization" });
      await expect(form.getByRole("textbox", { name: /Slug/ })).toHaveCount(0);

      // An existing account becomes the first Admin right away.
      await form.getByRole("textbox", { name: /^Name/ }).fill(memberOrgName);
      await form.getByRole("textbox", { name: /^First Admin/ }).fill(fixture.user.email);
      await form.getByRole("button", { name: "Create organization" }).click();
      const created = page.getByRole("article", { name: memberOrgName });
      await expect(created.getByText("1 member, 1 Admin")).toBeVisible();
      const [row] = await db.select({ slug: schema.organizations.slug }).from(schema.organizations)
        .where(eq(schema.organizations.name, memberOrgName));
      expect(row?.slug).toBe(organizationSlugBase(memberOrgName));

      // An address without an account gets an Admin invitation to send.
      await page.getByRole("navigation", { name: "Organizations" }).getByRole("button", { name: "New organization" }).click();
      await form.getByRole("textbox", { name: /^Name/ }).fill(invitedOrgName);
      await form.getByRole("textbox", { name: /^First Admin/ }).fill(`invite-${tag}@e2e.local`);
      await form.getByRole("button", { name: "Create organization" }).click();
      const invited = page.getByRole("article", { name: invitedOrgName });
      await expect(invited.getByText(`invite-${tag}@e2e.local has no account yet`)).toBeVisible();
      await expect(invited.getByRole("textbox", { name: "Invitation link" })).toHaveValue(/\/accept-invitation\/.+/);
      await expect(invited.getByText("No members yet. Nobody can sign in to this organization.")).toBeVisible();
    } finally {
      try {
        const orgs = await db.select({ id: schema.organizations.id }).from(schema.organizations)
          .where(like(schema.organizations.name, `E2E Platform % ${tag}`));
        const ids = orgs.map((org) => org.id);
        if (ids.length > 0) {
          // A new organization is seeded with a starter catalog (seedOrgDefaults);
          // it goes first, then the invitation, then the organization with its
          // membership.
          await db.transaction(async (tx) => {
            await tx.delete(schema.formulations).where(inArray(schema.formulations.organizationId, ids));
            await tx.delete(schema.feedstockTypes).where(inArray(schema.feedstockTypes.organizationId, ids));
            await tx.delete(schema.invitations).where(inArray(schema.invitations.organizationId, ids));
            await tx.delete(schema.organizations).where(inArray(schema.organizations.id, ids));
          });
        }
      } finally {
        await pool.end();
        await fixture.cleanup();
      }
    }
  });
});
