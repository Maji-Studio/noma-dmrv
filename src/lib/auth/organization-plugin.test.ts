/** Exercise the installed plugin through HTTP with the application's real config. */
import { createHmac } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { LAST_ADMIN_MESSAGE } from "./organization-role-policy";
const memory = vi.hoisted(() => Object.fromEntries(
  ["user", "organization", "member", "session", "invitation"].map(key => [key, [] as Record<string, unknown>[]]),
));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/org-defaults", () => ({ seedOrgDefaults: vi.fn() }));
vi.mock("@/data-access/api-credential-auth", () => ({ disableOwnerApiKeys: vi.fn() }));
vi.mock("@/data-access/oauth-grant-lifecycle", () => ({
  revokeMemberOAuthGrants: vi.fn(), revokeDeletedMemberOAuthGrants: vi.fn(),
}));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => memoryAdapter(memory) };
});
import { auth } from "./better-auth";
const ORIGIN = "http://localhost:3100";
const SESSION_LIFETIME_MS = 60_000;
beforeEach(() => {
  Object.values(memory).forEach(rows => rows.splice(0));
  for (const id of ["actor", "other"]) {
    memory.user.push({ id, email: `${id}@example.test`, name: "Test", emailVerified: true, role: "user", createdAt: new Date(), updatedAt: new Date() });
  }
  memory.organization.push({ id: "org", name: "Test", slug: "test", createdAt: new Date() });
  memory.member.push({ id: "actor-member", userId: "actor", organizationId: "org", role: "admin", createdAt: new Date() });
  memory.session.push({ id: "session", token: "test-token", userId: "actor", activeOrganizationId: "org", expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS), createdAt: new Date(), updatedAt: new Date() });
});
async function post(path: string, body: Record<string, unknown>) {
  const ctx = await auth.$context;
  const signature = createHmac("sha256", ctx.secret).update("test-token").digest("base64");
  return auth.handler(new Request(`${ORIGIN}/api/auth/organization/${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`test-token.${signature}`)}` },
    body: JSON.stringify({ organizationId: "org", ...body }),
  }));
}
it("gives a trusted organization creator the Admin role", async () => {
  const org = await auth.api.createOrganization({ body: { name: "New org", slug: "new-org", userId: "other" } });
  expect(memory.member.find(row => row.organizationId === org!.id)).toMatchObject({ userId: "other", role: "admin" });
});
it.each([
  ["update-member-role", { memberId: "actor-member", role: "member" }],
  ["remove-member", { memberIdOrEmail: "actor-member" }],
  ["leave", {}],
] as const)("refuses the last Admin's %s with actionable copy", async (path, body) => {
  const response = await post(path, body);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ message: LAST_ADMIN_MESSAGE });
  expect(memory.member).toMatchObject([{ id: "actor-member", role: "admin" }]);
});
it.each([
  ["update-member-role", { memberId: "actor-member", role: "member" }],
  ["remove-member", { memberIdOrEmail: "actor-member" }],
  ["leave", {}],
] as const)("allows %s when another Admin remains", async (path, body) => {
  memory.member.push({ id: "other-member", userId: "other", organizationId: "org", role: "admin", createdAt: new Date() });
  expect((await post(path, body)).status).toBe(200);
  expect(memory.member.find(row => row.id === "other-member")?.role).toBe("admin");
});
it.each([{ role: "owner" }, { role: "admin,member" }, { role: ["admin", "member"] }])("rejects unsupported role $role on direct plugin writes", async ({ role }) => {
  for (const path of ["invite-member", "update-member-role"]) {
    const response = await post(path, { role, memberId: "actor-member", userId: "other", email: "invite@example.test" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: "Choose Admin or Member." });
  }
});
it("lets Admins delete organizations", async () => {
  expect((await post("delete", {})).status).toBe(200);
  expect(memory.organization).toHaveLength(0);
});
it("lets an Admin promote another Member", async () => {
  memory.member.push({ id: "other-member", userId: "other", organizationId: "org", role: "member", createdAt: new Date() });
  expect((await post("update-member-role", { memberId: "other-member", role: "admin" })).status).toBe(200);
  expect(memory.member.find(row => row.id === "other-member")?.role).toBe("admin");
});
it.each(["admin", "member"])("lets an Admin invite a %s", async role => {
  expect((await post("invite-member", { role, email: "invite@example.test" })).status).toBe(200);
  expect(memory.invitation[0]).toMatchObject({ role, status: "pending" });
});
it.each(["delete", "update-member-role", "remove-member", "invite-member"])("refuses Member management via %s", async path => {
  memory.member[0].role = "member";
  const response = await post(path, { memberId: "actor-member", memberIdOrEmail: "actor-member", role: "admin", email: "invite@example.test" });
  expect(response.status).toBeGreaterThanOrEqual(400);
});

it("rejects the obsolete role through the server-only add-member endpoint", async () => {
  // @ts-expect-error Exercise callers that bypass TypeScript.
  await expect(auth.api.addMember({ body: { userId: "other", organizationId: "org", role: "owner" } })).rejects.toThrow("Choose Admin or Member.");
});
