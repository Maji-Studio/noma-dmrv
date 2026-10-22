import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { certifierCredentials, members, organizationApiAccess, organizations, users } from "@/db/schema";
import { listPlatformOrganizationDirectory } from "@/data-access/organizations";
import { listPlatformOrganizationsFn } from "@/fn/organizations";

const session = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/providers/better-auth-server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/providers/better-auth-server")>(),
  getBetterAuthSession: session,
}));
let ids: string[];
let userIds: string[];
beforeEach(async () => {
  ids = Array.from({ length: 3 }, () => randomUUID());
  userIds = Array.from({ length: 3 }, () => randomUUID());
  await db.insert(organizations).values(ids.map((id, index) => ({
    id, name: ["zebra", "Alpha", "beta"][index], slug: `directory-${id}`,
  })));
  await db.insert(users).values(userIds.map((id, index) => ({
    id, email: `${id}@example.test`, name: "Directory test", role: index === 0 ? "admin" : "user", emailVerified: true,
  })));
  await db.insert(members).values([
    { id: randomUUID(), organizationId: ids[0], userId: userIds[1], role: "admin" },
    { id: randomUUID(), organizationId: ids[0], userId: userIds[2], role: "member" },
    { id: randomUUID(), organizationId: ids[1], userId: userIds[1], role: "admin" },
    { id: randomUUID(), organizationId: ids[1], userId: userIds[2], role: "admin" },
  ]);
  await db.insert(organizationApiAccess).values([
    { organizationId: ids[1], enabled: true, changedByUserId: userIds[0] },
    { organizationId: ids[2], enabled: false, changedByUserId: userIds[0] },
  ]);
  // Intentionally not decryptable: the directory must never read or decrypt these values.
  await db.insert(certifierCredentials).values({
    organizationId: ids[0], provider: "isometric",
    accessTokenEncrypted: "test-ciphertext", clientSecretEncrypted: "test-ciphertext",
  });
  session.mockResolvedValue({ user: { id: userIds[0] }, session: { activeOrganizationId: null } });
});
afterEach(async () => {
  await db.delete(certifierCredentials).where(inArray(certifierCredentials.organizationId, ids));
  await db.delete(organizations).where(inArray(organizations.id, ids));
  await db.delete(users).where(inArray(users.id, userIds));
});

describe("Platform organization directory", () => {
  it("returns only directory fields, correct counts and defaults, ordered case-insensitively", async () => {
    const rows = (await listPlatformOrganizationDirectory()).filter((row) => ids.includes(row.id));
    expect(rows).toEqual([
      { id: ids[1], name: "Alpha", memberCount: 2, adminCount: 2, isometricKeysSaved: false, apiAccessEnabled: true },
      { id: ids[2], name: "beta", memberCount: 0, adminCount: 0, isometricKeysSaved: false, apiAccessEnabled: false },
      { id: ids[0], name: "zebra", memberCount: 2, adminCount: 1, isometricKeysSaved: true, apiAccessEnabled: true },
    ]);
    expect(await listPlatformOrganizationsFn()).toEqual({ success: true, data: expect.arrayContaining(rows) });
  });
  it("refuses an organization Admin in both layers", async () => {
    session.mockResolvedValue({ user: { id: userIds[1] }, session: { activeOrganizationId: ids[0] } });
    await expect(listPlatformOrganizationDirectory()).rejects.toThrow("Admin access is required");
    expect(await listPlatformOrganizationsFn()).toMatchObject({ success: false, error: "Admin access is required for this action." });
  });
});
