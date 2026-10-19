/** Database coverage for Platform Admin API access listing and toggles. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { members, organizationApiAccess, organizations, users } from "@/db/schema";
import { listOrganizationApiAccess, setOrganizationApiAccess } from "@/data-access/organization-api-access";
import { listOrganizationApiAccessFn, setOrganizationApiAccessFn } from "@/fn/organization-api-access";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/providers/better-auth-server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/providers/better-auth-server")>(),
  getBetterAuthSession: session,
}));

let ids: string[];
let adminId: string;
let ownerId: string;

beforeEach(async () => {
  ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  adminId = crypto.randomUUID();
  ownerId = crypto.randomUUID();
  await db.insert(organizations).values(ids.map((id) => ({ id, name: `API access ${id}`, slug: `api-access-${id}` })));
  await db.insert(users).values([
    { id: adminId, email: `${adminId}@example.test`, name: "API access admin", role: "admin", emailVerified: true },
    { id: ownerId, email: `${ownerId}@example.test`, name: "API access owner", role: "user", emailVerified: true },
  ]);
  await db.insert(members).values({ id: crypto.randomUUID(), organizationId: ids[0], userId: ownerId, role: "owner" });
  session.mockResolvedValue({ user: { id: adminId }, session: { activeOrganizationId: null } });
  await db.insert(organizationApiAccess).values([
    { organizationId: ids[1], enabled: true, changedByUserId: adminId },
    { organizationId: ids[2], enabled: false, changedByUserId: adminId },
  ]);
});
afterEach(async () => {
  await db.delete(organizations).where(inArray(organizations.id, ids));
  await db.delete(users).where(inArray(users.id, [adminId, ownerId]));
});

describe("Platform Admin API access directory", () => {
  it("reads every organization without an active organization, defaulting missing policy rows to on", async () => {
    const expected = expect.arrayContaining([
      { organizationId: ids[0], enabled: true },
      { organizationId: ids[1], enabled: true },
      { organizationId: ids[2], enabled: false },
    ]);
    expect(await listOrganizationApiAccess()).toEqual(expected);
    expect(await listOrganizationApiAccessFn()).toEqual({ success: true, data: expected });
  });

  it("disables and restores API access without an active organization, recording the acting admin", async () => {
    expect(await setOrganizationApiAccessFn({ id: ids[0], enabled: false })).toEqual({ success: true, data: undefined });
    let [stored] = await db.select().from(organizationApiAccess).where(eq(organizationApiAccess.organizationId, ids[0]));
    expect(stored).toMatchObject({ enabled: false, changedByUserId: adminId });
    // An existing policy records the current admin on update as well as insert.
    await db.update(users).set({ role: "admin" }).where(eq(users.id, ownerId));
    session.mockResolvedValue({ user: { id: ownerId }, session: { activeOrganizationId: null } });
    expect(await setOrganizationApiAccessFn({ id: ids[0], enabled: true })).toEqual({ success: true, data: undefined });
    [stored] = await db.select().from(organizationApiAccess).where(eq(organizationApiAccess.organizationId, ids[0]));
    expect(stored).toMatchObject({ enabled: true, changedByUserId: ownerId });
  });

  it("keeps Zod validation for the toggle action", async () => {
    expect(await setOrganizationApiAccessFn({ id: ids[0], enabled: "false" })).toMatchObject({
      success: false, code: "validation_failed",
    });
    expect(await db.select().from(organizationApiAccess).where(eq(organizationApiAccess.organizationId, ids[0]))).toEqual([]);
  });

  it("refuses an organization Owner without Platform Admin access in both layers", async () => {
    session.mockResolvedValue({ user: { id: ownerId }, session: { activeOrganizationId: ids[0] } });
    await expect(listOrganizationApiAccess()).rejects.toThrow("Admin access is required");
    await expect(setOrganizationApiAccess(ids[0], false)).rejects.toThrow("Admin access is required");
    const failure = { success: false, error: "Admin access is required for this action." };
    expect(await listOrganizationApiAccessFn()).toEqual(failure);
    expect(await setOrganizationApiAccessFn({ id: ids[0], enabled: false })).toEqual(failure);
    expect(await db.select().from(organizationApiAccess).where(eq(organizationApiAccess.organizationId, ids[0]))).toEqual([]);
  });
});
