import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/auth/providers/better-auth-server", () => ({ getBetterAuthSession: mocks.session }));
vi.mock("@/lib/log", () => ({ logger: { warn: mocks.warn, error: mocks.error } }));
vi.mock("./send", async importOriginal => ({
  ...(await importOriginal<typeof import("./send")>()), sendEmail: vi.fn(),
}));
import { sendEmail } from "./send";
import { sendPasswordChangedNotice, sendRemovedFromOrganizationNotice, sendRoleChangedNotice } from "./account-notices";
import { orgRoleLabel } from "@/lib/org-role-label";
import { env } from "@/config/env";

const MEMBER = { memberId: "member-id", organizationId: "organization-id", userId: "recipient-id",
  organizationName: "Private Organization", email: "recipient@example.test" };
const APP_URL = env.NEXT_PUBLIC_APP_URL;
afterEach(() => { env.NEXT_PUBLIC_APP_URL = APP_URL; });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockReset().mockResolvedValue({ user: { id: "actor-id", name: "Acting Admin" } });
  vi.mocked(sendEmail).mockReset().mockResolvedValue({ sent: true, id: "message" });
});
it("maps stored roles to the two template display labels", () => {
  expect(orgRoleLabel("admin")).toBe("Admin");
  expect(orgRoleLabel("member")).toBe("Member");
  expect(orgRoleLabel(null)).toBeNull();
  expect(orgRoleLabel(undefined)).toBeNull();
});
it("sends the password template with the recovery route and current time", async () => {
  const before = new Date();
  await sendPasswordChangedNotice(MEMBER);
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: "password-changed", userId: MEMBER.userId, to: MEMBER.email,
    subject: "Your noma password was changed", text: expect.stringContaining(`${env.NEXT_PUBLIC_APP_URL}/forgot-password`),
  }));
  const text = vi.mocked(sendEmail).mock.calls[0][0].text;
  expect(text).toContain(String(before.getUTCFullYear()));
});
it("maps roles once and names the acting session user", async () => {
  await sendRoleChangedNotice({ ...MEMBER, fromRole: "member", toRole: "admin" });
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    to: MEMBER.email, subject: `Your role in ${MEMBER.organizationName} is now Admin`,
    text: expect.stringContaining("Acting Admin changed your role"),
  }));
  expect(vi.mocked(sendEmail).mock.calls[0][0].text).toContain("Role: Member → Admin");
});
it("does not send a same-role notice or a self-removal notice", async () => {
  await sendRoleChangedNotice({ ...MEMBER, fromRole: "member", toRole: "member" });
  await sendRemovedFromOrganizationNotice({ ...MEMBER, actorUserId: MEMBER.userId });
  expect(sendEmail).not.toHaveBeenCalled();
});
it("does not notify a session actor removing their own membership", async () => {
  mocks.session.mockResolvedValue({ user: { id: MEMBER.userId, name: "Acting Admin" } });
  await sendRemovedFromOrganizationNotice(MEMBER);
  expect(mocks.session).toHaveBeenCalledOnce();
  expect(sendEmail).not.toHaveBeenCalled();
});
it.each([undefined, "actor-id"])("resolves the removal actor once with actorUserId=%s", async actorUserId => {
  await sendRemovedFromOrganizationNotice({ ...MEMBER, actorUserId });
  expect(mocks.session).toHaveBeenCalledOnce();
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    type: "removed-from-organization", text: expect.stringContaining("Acting Admin removed you"),
  }));
});
it("does not name a session actor who differs from the supplied actor", async () => {
  await sendRemovedFromOrganizationNotice({ ...MEMBER, actorUserId: "platform-admin-id" });
  expect(mocks.session).toHaveBeenCalledOnce();
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    text: expect.stringContaining("An Admin removed you"),
  }));
});
it.each(["password", "role", "removed"] as const)("normalizes a trailing app URL slash for %s notices", async notice => {
  env.NEXT_PUBLIC_APP_URL = "https://app.example.test/";
  if (notice === "password") await sendPasswordChangedNotice(MEMBER);
  else if (notice === "role") await sendRoleChangedNotice({ ...MEMBER, fromRole: "member", toRole: "admin" });
  else await sendRemovedFromOrganizationNotice(MEMBER);
  expect(sendEmail).toHaveBeenCalledOnce();
  const { html, text } = vi.mocked(sendEmail).mock.calls[0][0];
  expect(html).toContain('src="https://app.example.test/');
  expect(`${html}\n${text}`).not.toContain("https://app.example.test//");
  if (notice === "password") {
    expect(html).toContain('href="https://app.example.test/forgot-password"');
    expect(text).toContain("https://app.example.test/forgot-password");
  }
});
it("falls back to anonymous wording when the actor cannot be resolved", async () => {
  mocks.session.mockRejectedValue(new Error("private@example.test"));
  await sendRemovedFromOrganizationNotice(MEMBER);
  expect(sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    subject: `You were removed from ${MEMBER.organizationName}`, text: expect.stringContaining("An Admin removed you"),
  }));
});
it.each(["password", "role", "removed"] as const)("never throws or logs PII for failed %s delivery", async notice => {
  const send = () => notice === "password" ? sendPasswordChangedNotice(MEMBER)
    : notice === "role" ? sendRoleChangedNotice({ ...MEMBER, fromRole: "member", toRole: "admin" })
    : sendRemovedFromOrganizationNotice(MEMBER);
  vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "provider-error" });
  await expect(send()).resolves.toBeUndefined();
  expect(mocks.warn).toHaveBeenCalledOnce();
  vi.mocked(sendEmail).mockRejectedValue(new Error(`${MEMBER.email} ${MEMBER.organizationName}`));
  await expect(send()).resolves.toBeUndefined();
  expect(mocks.error).toHaveBeenCalledOnce();
  const logs = JSON.stringify([mocks.warn.mock.calls, mocks.error.mock.calls]);
  for (const privateValue of [MEMBER.email, MEMBER.organizationName, "Acting Admin"]) expect(logs).not.toContain(privateValue);
});
it("preserves local unconfigured fallback with no recipient PII", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(sendEmail).mockResolvedValue({ sent: false, reason: "not-configured" });
  await sendPasswordChangedNotice(MEMBER);
  expect(log).toHaveBeenCalledExactlyOnceWith(`[auth:password-changed] appUrl=${env.NEXT_PUBLIC_APP_URL}/forgot-password`);
});
it("gives each real event a unique provider key", async () => {
  await sendRoleChangedNotice({ ...MEMBER, fromRole: "member", toRole: "admin" });
  await sendRoleChangedNotice({ ...MEMBER, fromRole: "admin", toRole: "member" });
  await sendRoleChangedNotice({ ...MEMBER, fromRole: "member", toRole: "admin" });
  const keys = vi.mocked(sendEmail).mock.calls.map(([input]) => input.idempotencyKey);
  expect(keys.every(key => key?.includes(MEMBER.memberId))).toBe(true);
  expect(new Set(keys).size).toBe(keys.length);
});
