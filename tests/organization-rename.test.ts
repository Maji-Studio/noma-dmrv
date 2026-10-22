import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { renameActiveOrganization } from "@/data-access/organizations";
import type { OrgContext } from "@/lib/auth/server";

const insertedIds: string[] = [];

async function insertOrganization(slug = `old-${randomUUID()}`) {
  const id = randomUUID();
  insertedIds.push(id);
  await db.insert(organizations).values({ id, name: "Original", slug });
  return id;
}

function context(organizationId: string): OrgContext {
  return { userId: "rename-test-user", organizationId, orgRole: "admin", isPlatformAdmin: false };
}

async function readOrganization(id: string) {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, id));
  return row;
}

afterEach(async () => {
  if (insertedIds.length) {
    await db.delete(organizations).where(inArray(organizations.id, insertedIds));
    insertedIds.length = 0;
  }
});

describe("rename active organization", () => {
  it("renames name and slug without touching another organization", async () => {
    const id = await insertOrganization();
    const otherId = await insertOrganization();
    const otherBefore = await readOrganization(otherId);
    const name = `Renamed ${randomUUID()}`;
    const expected = { name, slug: name.toLowerCase().replaceAll(" ", "-") };
    expect(await renameActiveOrganization(context(id), { name })).toEqual(expected);
    expect(await readOrganization(id)).toMatchObject(expected);
    expect(await readOrganization(otherId)).toEqual(otherBefore);
  });

  it.each(["", "-2"])("keeps an existing matching slug%s", async (suffix) => {
    const base = `same-${randomUUID()}`;
    const id = await insertOrganization(`${base}${suffix}`);
    const name = `${base.toUpperCase()}!!!`;
    expect(await renameActiveOrganization(context(id), { name }))
      .toEqual({ name, slug: `${base}${suffix}` });
  });

  it.each([2, 3])("chooses the lowest free candidate %i", async (candidate) => {
    const base = `taken-${randomUUID()}`;
    await insertOrganization(base);
    if (candidate === 3) await insertOrganization(`${base}-2`);
    await insertOrganization(`${base}-4`);
    const id = await insertOrganization();
    expect(await renameActiveOrganization(context(id), { name: base }))
      .toEqual({ name: base, slug: `${base}-${candidate}` });
  });

  it("refuses a Member and leaves the row unchanged", async () => {
    const id = await insertOrganization();
    const before = await readOrganization(id);
    await expect(renameActiveOrganization({ ...context(id), orgRole: "member" }, { name: "Refused" }))
      .rejects.toThrow("Only organization Admins can rename the organization.");
    expect(await readOrganization(id)).toEqual(before);
  });

  it("permits a Platform Admin without a membership", async () => {
    const id = await insertOrganization();
    const name = `Platform ${randomUUID()}`;
    expect(await renameActiveOrganization({ ...context(id), orgRole: null, isPlatformAdmin: true }, { name }))
      .toMatchObject({ name });
  });

  it("refuses a missing organization", async () => {
    await expect(renameActiveOrganization(context(randomUUID()), { name: "Missing" }))
      .rejects.toThrow("Organization was not found.");
  });
});
