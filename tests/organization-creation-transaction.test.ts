import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { feedstockTypes, formulations, members, organizations, users } from "@/db/schema";

vi.mock("@/lib/auth/server", () => ({
  requirePlatformAdmin: vi.fn().mockResolvedValue({}),
}));

import { createOrganizationWithAdmin } from "@/data-access/organizations";

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
    const orgIds = db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, organizationSlug));
    await db.delete(feedstockTypes).where(inArray(feedstockTypes.organizationId, orgIds));
    await db.delete(formulations).where(inArray(formulations.organizationId, orgIds));
    await db.delete(organizations).where(eq(organizations.slug, organizationSlug));
  }
  if (adminUserId) {
    await db.delete(users).where(eq(users.id, adminUserId));
  }
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
      name: "Creation test",
      slug: organizationSlug,
      adminUserId,
    });
    expect(await db.select().from(members).where(eq(members.organizationId, org.id)))
      .toMatchObject([{ userId: adminUserId, role: "admin" }]);
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
        name: "Rollback Organization",
        slug: organizationSlug,
        adminUserId,
      }),
    ).rejects.toThrow();

    const rows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, organizationSlug));
    expect(rows).toEqual([]);
  });
});
