/** DB suite: written for reviewer execution, not run during the admin follow-up. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { organizationApiAccess, organizations } from "@/db/schema";
import { listOrganizationApiAccess } from "@/data-access/organization-api-access";
import type { OrgContext } from "@/lib/auth/server";

let ids: string[];
let owner: OrgContext;

beforeEach(async () => {
  ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await db.insert(organizations).values(ids.map((id) => ({ id, name: `API access ${id}`, slug: `api-access-${id}` })));
  owner = { userId: "api-access-owner", organizationId: ids[0], orgRole: "owner", isPlatformAdmin: false };
  await db.insert(organizationApiAccess).values([
    { organizationId: ids[1], enabled: true, changedByUserId: "api-access-admin" },
    { organizationId: ids[2], enabled: false, changedByUserId: "api-access-admin" },
  ]);
});
afterEach(async () => {
  await db.delete(organizations).where(inArray(organizations.id, ids));
});

describe("Platform Admin API access directory", () => {
  it("reads every organization, defaulting missing policy rows to on", async () => {
    const admin: OrgContext = { ...owner, orgRole: null, isPlatformAdmin: true };
    const rows = await listOrganizationApiAccess(admin);
    expect(rows).toEqual(expect.arrayContaining([
      { organizationId: ids[0], enabled: true },
      { organizationId: ids[1], enabled: true },
      { organizationId: ids[2], enabled: false },
    ]));
  });

  it("refuses an organization Owner without Platform Admin access", async () => {
    await expect(listOrganizationApiAccess(owner)).rejects.toMatchObject({ code: "forbidden" });
  });
});
