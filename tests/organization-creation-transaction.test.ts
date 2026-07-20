import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";

vi.mock("@/lib/auth/server", () => ({
  requirePlatformAdmin: vi.fn().mockResolvedValue({}),
}));

import { createOrganizationWithOwner } from "@/data-access/organizations";

let triggerName: string | null = null;
let functionName: string | null = null;
let ownerUserId: string | null = null;
let organizationSlug: string | null = null;

afterEach(async () => {
  if (triggerName) {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS "${triggerName}" ON members`));
  }
  if (functionName) {
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS "${functionName}"()`));
  }
  if (organizationSlug) {
    await db.delete(organizations).where(eq(organizations.slug, organizationSlug));
  }
  if (ownerUserId) {
    await db.delete(users).where(eq(users.id, ownerUserId));
  }
  triggerName = null;
  functionName = null;
  ownerUserId = null;
  organizationSlug = null;
});

describe("organization creation transaction", () => {
  it("rolls back the organization when Owner creation fails", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    triggerName = `test_fail_member_${suffix}`;
    functionName = `test_fail_member_fn_${suffix}`;
    ownerUserId = `owner-${suffix}`;
    organizationSlug = `rollback-${suffix}`;
    await db.insert(users).values({
      id: ownerUserId,
      email: `${organizationSlug}@example.test`,
      name: "Rollback Owner",
      emailVerified: true,
    });

    await db.execute(sql.raw(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM organizations
          WHERE id = NEW.organization_id AND slug = '${organizationSlug}'
        ) THEN
          RAISE EXCEPTION 'injected Owner creation failure';
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
      createOrganizationWithOwner({
        name: "Rollback Organization",
        slug: organizationSlug,
        ownerUserId,
      }),
    ).rejects.toThrow();

    const rows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, organizationSlug));
    expect(rows).toEqual([]);
  });
});
