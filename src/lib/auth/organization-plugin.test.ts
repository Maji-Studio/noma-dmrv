/** Exercise the installed plugin through HTTP with the application's real config. */
import { createHmac, randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { INVITATION_EXPIRES_IN_SECONDS } from "@/config/auth";
import { SafeError } from "@/lib/errors";
import { revokeDeletedMemberOAuthGrants } from "@/data-access/oauth-grant-lifecycle";
import { LAST_ADMIN_MESSAGE } from "./organization-role-policy";
import { replacePendingInvitation } from "@/data-access/organizations";
const cookieStore = vi.hoisted(() => ({ getAll: () => [{ name: "better-auth.session_data" }, { name: "better-auth.session_token" }], delete: vi.fn() }));
const databaseFailure = vi.hoisted(() => ({ enabled: false }));
const memory = vi.hoisted(() => Object.fromEntries(
  ["user", "organization", "member", "session", "invitation", "verification", "account"].map(key => [key, [] as Record<string, unknown>[]]),
));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/org-defaults", () => ({ seedOrgDefaults: vi.fn() }));
vi.mock("@/data-access/api-credential-auth", () => ({ disableOwnerApiKeys: vi.fn() }));
vi.mock("@/data-access/oauth-grant-lifecycle", () => ({
  revokeMemberOAuthGrants: vi.fn(), revokeDeletedMemberOAuthGrants: vi.fn(),
}));
vi.mock("better-auth/adapters/drizzle", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => {
    const factory = memoryAdapter(memory);
    function injectFailure(adapter: Omit<ReturnType<typeof factory>, "transaction">) {
      const update = adapter.update.bind(adapter);
      adapter.update = async args => {
        if (databaseFailure.enabled && args.model === "member") {
          throw new Error("Query failed", { cause: Object.assign(new Error("Last Admin"), {
            code: "23514", constraint: "members_last_admin",
          }) });
        }
        return update(args);
      };
      const remove = adapter.delete.bind(adapter);
      adapter.delete = async args => {
        if (databaseFailure.enabled && args.model === "member") {
          throw new Error("Query failed", { cause: Object.assign(new Error("Last Admin"), {
            code: "23514", constraint: "members_last_admin",
          }) });
        }
        return remove(args);
      };
    }
    return (options: Parameters<typeof factory>[0]) => {
      const adapter = factory(options);
      injectFailure(adapter);
      const transaction = adapter.transaction.bind(adapter);
      adapter.transaction = callback => transaction(tx => {
        injectFailure(tx);
        return callback(tx);
      });
      return adapter;
    };
  } };
});
import { auth } from "./better-auth";
vi.mock("next/headers", () => ({ headers: () => sessionHeaders(), cookies: () => cookieStore }));
vi.mock("@/data-access/organizations", () => ({
  getActiveOrganization: async () => memory.organization[0],
  // The real scoped transaction is exercised by organization-invitation-delivery.test.ts.
  replacePendingInvitation: vi.fn(async (ctx: { userId: string; organizationId: string }, { invitationId }: { invitationId: string }) => {
    const invitation = memory.invitation.find(row => row.id === invitationId && row.organizationId === ctx.organizationId && row.status === "pending");
    if (!invitation) throw new SafeError("Invitation not found or is no longer pending.");
    const fresh = { ...invitation, id: randomUUID(), inviterId: ctx.userId,
      expiresAt: new Date(Date.now() + INVITATION_EXPIRES_IN_SECONDS * MILLISECONDS_PER_SECOND) };
    invitation.status = "canceled";
    memory.invitation.push(fresh);
    return fresh;
  }),
}));
vi.mock("@/lib/email/send", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email/send")>()),
  sendEmail: vi.fn(),
}));
import { sendEmail } from "@/lib/email/send";
import { changePasswordFn } from "@/fn/profile";
vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: async () => ({ userId: "actor", organizationId: "org", orgRole: memory.member.find(row => row.userId === "actor")?.role ?? null, isPlatformAdmin: false }),
  requireOrgRole: (ctx: { orgRole: string | null }) => {
    if (ctx.orgRole !== "admin") throw new SafeError("Admin access is required.");
  },
}));
import { changeMemberRoleAction, inviteMemberAction, leaveOrganizationAction, removeMemberAction, resendInvitationAction, revokeInvitationAction } from "@/fn/organizations";
const ORIGIN = "http://localhost:3100";
const SESSION_LIFETIME_MS = 60_000;
const MILLISECONDS_PER_SECOND = 1_000;
beforeEach(() => {
  vi.mocked(sendEmail).mockReset().mockResolvedValue({ sent: true, id: "message-123" });
  databaseFailure.enabled = false;
  vi.mocked(replacePendingInvitation).mockClear();
  vi.mocked(revokeDeletedMemberOAuthGrants).mockClear();
  cookieStore.delete.mockClear();
  Object.values(memory).forEach(rows => rows.splice(0));
  for (const id of ["actor", "other"]) {
    memory.user.push({ id, email: `${id}@example.test`, name: "Test", emailVerified: true, role: "user", createdAt: new Date(), updatedAt: new Date() });
  }
  memory.organization.push({ id: "org", name: "Test", slug: "test", createdAt: new Date() });
  memory.member.push({ id: "actor-member", userId: "actor", organizationId: "org", role: "admin", createdAt: new Date() });
  memory.session.push({ id: "session", token: "test-token", userId: "actor", activeOrganizationId: "org", expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS), createdAt: new Date(), updatedAt: new Date() });
});
async function sessionHeaders() {
  const ctx = await auth.$context;
  const signature = createHmac("sha256", ctx.secret).update("test-token").digest("base64");
  return new Headers({ origin: ORIGIN, "content-type": "application/json", cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`test-token.${signature}`)}` });
}
async function post(path: string, body: Record<string, unknown>) {
  return auth.handler(new Request(`${ORIGIN}/api/auth/organization/${path}`, {
    method: "POST",
    headers: await sessionHeaders(),
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
it("refuses Admin organization deletion without clearing the active organization", async () => {
  const response = await post("delete", {});
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "ORGANIZATION_DELETION_DISABLED" });
  expect(memory.organization).toHaveLength(1);
  expect(memory.session[0].activeOrganizationId).toBe("org");
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
it.each([
  ["delete", 404, "ORGANIZATION_DELETION_DISABLED"],
  ["update-member-role", 403, "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER"],
  ["remove-member", 401, "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER"],
  ["invite-member", 403, "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION"],
] as const)("refuses Member management via %s", async (path, status, code) => {
  memory.member[0].role = "member";
  const response = await post(path, { memberId: "actor-member", memberIdOrEmail: "actor-member", role: "admin", email: "invite@example.test" });
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ code });
});

it("rejects the obsolete role through the server-only add-member endpoint", async () => {
  // @ts-expect-error Exercise callers that bypass TypeScript.
  await expect(auth.api.addMember({ body: { userId: "other", organizationId: "org", role: "owner" } })).rejects.toThrow("Choose Admin or Member.");
});

it("refuses a Member removing an Admin as a permission failure", async () => {
  memory.member[0].role = "member";
  memory.member.push({ id: "other-member", userId: "other", organizationId: "org", role: "admin", createdAt: new Date() });
  const response = await post("remove-member", { memberIdOrEmail: "other-member" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER", message: "You are not allowed to remove this member." });
});

it("refuses acceptance of a pending legacy Owner invitation", async () => {
  memory.member.splice(0);
  memory.invitation.push({ id: "legacy-invite", organizationId: "org", inviterId: "other", email: "actor@example.test",
    role: "owner", status: "pending", expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) });
  const response = await post("accept-invitation", { invitationId: "legacy-invite" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ message: "Choose Admin or Member." });
  expect(memory.member).toHaveLength(0);
  expect(memory.invitation[0].status).toBe("pending");
});

it("returns the real plugin last-Admin refusal in ActionResult.error", async () => {
  expect(await changeMemberRoleAction({ memberId: "actor-member", role: "member" })).toEqual({
    success: false, error: LAST_ADMIN_MESSAGE,
  });
});

it("maps the database invariant through the real plugin and server action", async () => {
  // The plugin's precheck saw two Admins; simulate the trigger refusing the
  // write after a concurrent transaction removed the other Admin.
  memory.member.push({ id: "other-member", userId: "other", organizationId: "org", role: "admin", createdAt: new Date() });
  databaseFailure.enabled = true;
  const response = await post("update-member-role", { memberId: "actor-member", role: "member" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "LAST_ADMIN", message: LAST_ADMIN_MESSAGE });
  expect(await changeMemberRoleAction({ memberId: "actor-member", role: "member" })).toEqual({
    success: false, error: LAST_ADMIN_MESSAGE,
  });
});


it.each([true, false])("direct HTTP invitations send once and retain the invitation when sent=%s", async (sent) => {
  vi.mocked(sendEmail).mockResolvedValue(sent
    ? { sent: true, id: "message-123" }
    : { sent: false, reason: "provider-error" });
  expect((await post("invite-member", { role: "member", email: "invite@example.test" })).status).toBe(200);
  expect(memory.invitation).toHaveLength(1);
  expect(memory.invitation[0]).toMatchObject({ status: "pending", email: "invite@example.test" });
  expect(sendEmail).toHaveBeenCalledOnce();
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: "invite@example.test",
    html: expect.stringContaining(`/accept-invitation/${memory.invitation[0].id}`),
  }));
});

it.each([true, false])("the real plugin and member action send exactly once and report sent=%s", async (sent) => {
  vi.mocked(sendEmail).mockResolvedValue(sent
    ? { sent: true, id: "message-123" }
    : { sent: false, reason: "provider-error" });
  const result = await inviteMemberAction({ role: "member", email: "invite@example.test" });
  expect(result).toMatchObject({ success: true, data: { emailSent: sent } });
  expect(memory.invitation).toHaveLength(1);
  expect(memory.invitation[0]).toMatchObject({ status: "pending", email: "invite@example.test" });
  expect(sendEmail).toHaveBeenCalledOnce();
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
    to: "invite@example.test",
    html: expect.stringContaining(`/accept-invitation/${memory.invitation[0].id}`),
  }));
});


it("returns the same reset response for existing and unknown accounts when delivery fails", async () => {
  vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "provider-error" });
  const reset = (email: string) => auth.handler(new Request(`${ORIGIN}/api/auth/request-password-reset`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }));
  const existing = await reset("actor@example.test");
  const unknown = await reset("unknown@example.test");
  expect(existing.status).toBe(200);
  expect(unknown.status).toBe(existing.status);
  expect(await existing.json()).toEqual(await unknown.json());
  expect(sendEmail).toHaveBeenCalledOnce();
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ type: "reset-password", userId: "actor" }));
});


it.each([
  { expired: false, sent: true }, { expired: false, sent: false },
  { expired: true, sent: true }, { expired: true, sent: false },
])("uses the replacement seam for expired=$expired and sends once (sent=$sent)", async ({ expired, sent }) => {
  const now = Date.now();
  memory.invitation.push({ id: "old-invite", organizationId: "org", inviterId: "actor", email: "invite@example.test",
    role: "member", status: "pending", expiresAt: new Date(now + (expired ? -SESSION_LIFETIME_MS : SESSION_LIFETIME_MS)) });
  vi.mocked(sendEmail).mockResolvedValue(sent ? { sent: true, id: "message" } : { sent: false, reason: "provider-error" });
  const result = await resendInvitationAction({ invitationId: "old-invite" });
  expect(result).toMatchObject({ success: true, data: { emailSent: sent } });
  expect(replacePendingInvitation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ organizationId: "org", userId: "actor" }), { invitationId: "old-invite" });
  expect(memory.invitation).toHaveLength(2);
  expect(memory.invitation[0].status).toBe("canceled");
  const fresh = memory.invitation[1];
  expect(fresh.id).not.toBe("old-invite");
  expect(fresh).toMatchObject({ organizationId: "org", email: "invite@example.test", role: "member", status: "pending" });
  expect(new Date(fresh.expiresAt as Date).getTime()).toBeGreaterThanOrEqual(now + INVITATION_EXPIRES_IN_SECONDS * MILLISECONDS_PER_SECOND);
  expect(new Date(fresh.expiresAt as Date).getTime()).toBeLessThanOrEqual(Date.now() + INVITATION_EXPIRES_IN_SECONDS * MILLISECONDS_PER_SECOND);
  expect(result).toMatchObject({ data: { invitationId: fresh.id, acceptUrl: `${ORIGIN}/accept-invitation/${fresh.id}` } });
  expect(sendEmail).toHaveBeenCalledOnce();
  expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ invitationId: fresh.id, idempotencyKey: `org-invite/${fresh.id}` }));
  // Even a recipient in the organization cannot accept the old link.
  memory.invitation[0].email = "actor@example.test";
  expect((await post("accept-invitation", { invitationId: "old-invite" })).status).toBe(400);
});

it.each(["missing", "other-org", "accepted", "rejected", "canceled"])("refuses resending %s without a write or email", async state => {
  if (state !== "missing") memory.invitation.push({ id: "old-invite", organizationId: state === "other-org" ? "elsewhere" : "org",
    email: "invite@example.test", role: "member", status: state === "other-org" ? "pending" : state });
  const before = structuredClone(memory.invitation);
  expect(await resendInvitationAction({ invitationId: "old-invite" })).toEqual({ success: false, error: "Invitation not found or is no longer pending." });
  expect(memory.invitation).toEqual(before);
  expect(sendEmail).not.toHaveBeenCalled();
});

it("refuses a Member sending an invitation again", async () => {
  memory.member[0].role = "member";
  expect(await resendInvitationAction({ invitationId: "old-invite" })).toEqual({ success: false, error: "Admin access is required." });
  expect(sendEmail).not.toHaveBeenCalled();
});

it.each(["member", "admin"])("leaves as %s, clears the active session/cache and calls the existing credential revocation seam", async role => {
  memory.member[0].role = role;
  memory.member.push({ id: "other-member", userId: "other", organizationId: "org", role: "admin", createdAt: new Date() });
  expect(await leaveOrganizationAction()).toEqual({ success: true, data: { organizationId: null } });
  expect(memory.member.map(row => row.id)).toEqual(["other-member"]);
  expect(memory.session[0].activeOrganizationId).toBeNull();
  expect(revokeDeletedMemberOAuthGrants).toHaveBeenCalledOnce();
  expect(revokeDeletedMemberOAuthGrants).toHaveBeenCalledWith(expect.objectContaining({ id: "actor-member", userId: "actor", organizationId: "org" }));
  expect(cookieStore.delete).toHaveBeenCalledWith("better-auth.session_data");
  expect(cookieStore.delete).not.toHaveBeenCalledWith("better-auth.session_token");
});

it.each([false, true])("preserves membership/session and credentials on last-Admin refusal (database=%s)", async database => {
  if (database) memory.member.push({ id: "other-member", userId: "other", organizationId: "org", role: "admin", createdAt: new Date() });
  databaseFailure.enabled = database;
  expect(await leaveOrganizationAction()).toEqual({ success: false, error: LAST_ADMIN_MESSAGE });
  expect(memory.member[0].id).toBe("actor-member");
  expect(memory.session[0].activeOrganizationId).toBe("org");
  expect(revokeDeletedMemberOAuthGrants).not.toHaveBeenCalled();
  expect(cookieStore.delete).not.toHaveBeenCalled();
});


function addNoticeMember(role = "member") {
  memory.member.push({ id: "other-member", userId: "other", organizationId: "org", role, createdAt: new Date() });
}

it("sends one role notice through the real plugin and action to the changed member", async () => {
  addNoticeMember();
  memory.user[0].name = "Acting Admin";
  memory.user[1].name = "Recipient Name";
  expect(await changeMemberRoleAction({ memberId: "other-member", role: "admin" })).toMatchObject({ success: true });
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: "role-changed", userId: "other", to: "other@example.test",
    subject: "Your role in Test is now Admin", text: expect.stringContaining("Acting Admin changed your role"),
  }));
});

it("sends nothing for a same-role update", async () => {
  addNoticeMember();
  expect(await changeMemberRoleAction({ memberId: "other-member", role: "member" })).toMatchObject({ success: true });
  expect(sendEmail).not.toHaveBeenCalled();
});

it("sends one removal notice through the real plugin and action", async () => {
  addNoticeMember();
  expect(await removeMemberAction({ memberIdOrEmail: "other-member" })).toMatchObject({ success: true });
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: "removed-from-organization", userId: "other", to: "other@example.test",
    subject: "You were removed from Test",
  }));
});

it("sends no removal notice when leaving or revoking a pending invitation", async () => {
  addNoticeMember("admin");
  memory.invitation.push({ id: "pending", email: "invite@example.test", organizationId: "org", inviterId: "actor",
    role: "member", status: "pending", expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS) });
  expect(await revokeInvitationAction({ invitationId: "pending" })).toMatchObject({ success: true });
  expect(await leaveOrganizationAction()).toMatchObject({ success: true });
  expect(sendEmail).not.toHaveBeenCalled();
});

it.each(["role", "remove"] as const)("keeps the %s action successful on resolved and thrown delivery failures", async path => {
  for (const thrown of [false, true]) {
    addNoticeMember();
    if (thrown) vi.mocked(sendEmail).mockRejectedValue(new Error("private@example.test"));
    else vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "provider-error" });
    const result = path === "role"
      ? await changeMemberRoleAction({ memberId: "other-member", role: "admin" })
      : await removeMemberAction({ memberIdOrEmail: "other-member" });
    expect(result).toMatchObject({ success: true });
    expect(memory.member.find(row => row.id === "other-member")?.role).toBe(path === "role" ? "admin" : undefined);
    memory.member.splice(1);
  }
});

const NOTICE_OLD_PASSWORD = "old-password-for-notice";
const NOTICE_NEW_PASSWORD = "new-password-for-notice";
async function addNoticeCredential() {
  const context = await auth.$context;
  memory.account.push({ id: "credential", userId: "actor", accountId: "actor", providerId: "credential",
    password: await context.password.hash(NOTICE_OLD_PASSWORD), createdAt: new Date(), updatedAt: new Date() });
}
async function postAuth(path: string, body: Record<string, unknown>) {
  return auth.handler(new Request(`${ORIGIN}/api/auth/${path}`, {
    method: "POST", headers: await sessionHeaders(), body: JSON.stringify(body),
  }));
}
it("sends exactly one password notice after Profile changes the password", async () => {
  await addNoticeCredential();
  expect(await changePasswordFn({ currentPassword: NOTICE_OLD_PASSWORD, newPassword: NOTICE_NEW_PASSWORD,
    confirmPassword: NOTICE_NEW_PASSWORD })).toMatchObject({ success: true });
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: "password-changed", userId: "actor", to: "actor@example.test",
    subject: "Your noma password was changed", text: expect.stringContaining(`${ORIGIN}/forgot-password`),
  }));
});
it.each([false, true])("direct password changes remain successful when delivery throws=%s", async thrown => {
  await addNoticeCredential();
  if (thrown) vi.mocked(sendEmail).mockRejectedValue(new Error("private@example.test"));
  else vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "provider-error" });
  expect((await postAuth("change-password", { currentPassword: NOTICE_OLD_PASSWORD,
    newPassword: NOTICE_NEW_PASSWORD, revokeOtherSessions: false })).status).toBe(200);
  expect(sendEmail).toHaveBeenCalledOnce();
});
it.each(["sent", "provider-error", "throw"] as const)("reset sends one notice and succeeds with delivery=%s", async delivery => {
  await addNoticeCredential();
  memory.verification.push({ id: "reset-verification", identifier: "reset-password:notice-token", value: "actor",
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS), createdAt: new Date(), updatedAt: new Date() });
  if (delivery === "throw") vi.mocked(sendEmail).mockRejectedValue(new Error("private@example.test"));
  else if (delivery === "provider-error") vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "provider-error" });
  expect((await postAuth("reset-password", { token: "notice-token", newPassword: NOTICE_NEW_PASSWORD })).status).toBe(200);
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: "password-changed", to: "actor@example.test", subject: "Your noma password was changed",
  }));
});
it("does not notify on refused password changes or resets", async () => {
  await addNoticeCredential();
  expect((await postAuth("change-password", { currentPassword: "wrong-password", newPassword: NOTICE_NEW_PASSWORD })).status).toBe(400);
  expect((await postAuth("reset-password", { token: "invalid", newPassword: NOTICE_NEW_PASSWORD })).status).toBe(400);
  expect(sendEmail).not.toHaveBeenCalled();
});
it("does not treat a first password established through a reset token as a change", async () => {
  memory.verification.push({ id: "first-verification", identifier: "reset-password:first-token", value: "actor",
    expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS), createdAt: new Date(), updatedAt: new Date() });
  expect((await postAuth("reset-password", { token: "first-token", newPassword: NOTICE_NEW_PASSWORD })).status).toBe(200);
  expect(memory.account).toHaveLength(1);
  expect(sendEmail).not.toHaveBeenCalled();
});


it("does not send a removal notice when an Admin removes their own membership", async () => {
  addNoticeMember("admin");
  expect(await removeMemberAction({ memberIdOrEmail: "actor-member" })).toMatchObject({ success: true });
  expect(sendEmail).not.toHaveBeenCalled();
});
