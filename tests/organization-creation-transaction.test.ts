import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { feedstockTypes, formulations, invitations, members, organizations, users } from "@/db/schema";

vi.mock("@/lib/auth/server", () => ({
  requirePlatformAdmin: vi.fn().mockResolvedValue({}),
}));

import { requirePlatformAdmin } from "@/lib/auth/server";
import { organizationSlugBase } from "@/lib/organizations/organization-slug";
import { createOrganizationWithAdmin } from "@/data-access/organizations";

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const createdIds: string[] = [];

let triggerName: string | null = null;
let functionName: string | null = null;
let adminUserId: string | null = null;
let organizationSlug: string | null = null;

afterEach(async () => {
  if (triggerName) {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${triggerName}" ON members`));
  }
  if (functionName) {
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${functionName}"()`));
  }
  if (organizationSlug) {
    // Organization creation seeds starter rows (seedOrgDefaults): clear them first.
    const orgIds = db.select({ id: organizations.id }).from(organizations).where(or(eq(organizations.slug, organizationSlug), inArray(organizations.id, createdIds)));
    await db.delete(feedstockTypes).where(inArray(feedstockTypes.organizationId, orgIds));
    await db.delete(formulations).where(inArray(formulations.organizationId, orgIds));
    await db.delete(organizations).where(or(eq(organizations.slug, organizationSlug), inArray(organizations.id, createdIds)));
  }
  if (adminUserId) {
    await db.delete(users).where(eq(users.id, adminUserId));
  }
  createdIds.length = 0;
  triggerName = null;
  functionName = null;
  adminUserId = null;
  organizationSlug = null;
});

describe("organization creation transaction", () => {
  it("makes the selected account the first Admin", async () => {
    adminUserId = randomUUID();
    organizationSlug = `creation-${randomUUID()}`;
    await db.insert(users).values({
      id: adminUserId,
      email: `${adminUserId}@example.test`,
      name: "Test",
      emailVerified: true,
    });
    const org = await createOrganizationWithAdmin({
      name: organizationSlug,
      adminEmail: `  ${adminUserId.toUpperCase()}@EXAMPLE.TEST  `,
    });
    expect(await db.select().from(members).where(eq(members.organizationId, org.id)))
      .toMatchObject([{ userId: adminUserId, role: "admin" }]);
  });

  it("derives slugs, suffixes collisions and creates pending invitations for an unknown account", async () => {
    adminUserId = randomUUID();
    await db.insert(users).values({
      id: adminUserId, email: `${adminUserId}@example.test`, name: "Platform Admin", role: "admin",
    });
    vi.mocked(requirePlatformAdmin).mockResolvedValue({ id: adminUserId } as never);
    const name = `New company ${randomUUID()}`;
    organizationSlug = organizationSlugBase(name);
    const email = `${randomUUID()}@example.test`;
    for (const suffix of ["", "-2", "-3"]) {
      const before = Date.now();
      const org = await createOrganizationWithAdmin({ name, adminEmail: `  ${email.toUpperCase()}  ` });
      createdIds.push(org.id);
      expect(org.firstAdmin.kind).toBe("invited");
      expect(await db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.id, org.id)))
        .toEqual([{ slug: `${organizationSlug}${suffix}` }]);
      expect(await db.select().from(members).where(eq(members.organizationId, org.id))).toEqual([]);
      const [invitation] = await db.select().from(invitations).where(eq(invitations.organizationId, org.id));
      expect(invitation).toMatchObject({ email, role: "admin", status: "pending", inviterId: adminUserId });
      expect(org.firstAdmin).toEqual({ kind: "invited", invitationId: invitation.id });
      expect(invitation.expiresAt?.getTime()).toBeGreaterThanOrEqual(before + INVITATION_LIFETIME_MS);
      expect(invitation.expiresAt?.getTime()).toBeLessThanOrEqual(Date.now() + INVITATION_LIFETIME_MS);
    }
  });

  it("rolls back the organization when Admin creation fails", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    triggerName = `test_fail_member_${suffix}`;
    functionName = `test_fail_member_fn_${suffix}`;
    adminUserId = `owner-${suffix}`;
    organizationSlug = `rollback-${suffix}`;
    await db.insert(users).values({
      id: adminUserId,
      email: `${organizationSlug}@example.test`,
      name: "Rollback Admin",
      emailVerified: true,
    });

    await db.execute(sql.raw(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM organizations
          WHERE id = NEW.organization_id AND slug = '${organizationSlug}'
        ) THEN
          RAISE EXCEPTION 'injected Admin creation failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `));
    await db.execute(sql.raw(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON members
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"()
    `));

    await expect(
      createOrganizationWithAdmin({
        name: organizationSlug,
        adminEmail: `${organizationSlug}@example.test`,
      }),
    ).rejects.toThrow();

    const rows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(or(eq(organizations.slug, organizationSlug), inArray(organizations.id, createdIds)));
    expect(rows).toEqual([]);
  });
});
