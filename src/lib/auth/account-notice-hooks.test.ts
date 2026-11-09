import { APIError } from "better-auth/api";
import { beforeEach, expect, it, vi } from "vitest";
import { revokeUserOAuthGrants } from "@/data-access/oauth-grant-lifecycle";
import { sendPasswordChangedNotice } from "@/lib/email/account-notices";
import { logger } from "@/lib/log";
import { capturePasswordResetNotice, deliverPasswordNotice } from "./account-notice-hooks";

vi.mock("@/data-access/oauth-grant-lifecycle", () => ({ revokeUserOAuthGrants: vi.fn() }));
vi.mock("@/lib/email/account-notices", () => ({ sendPasswordChangedNotice: vi.fn() }));
vi.mock("@/lib/log", () => ({ logger: { warn: vi.fn() } }));
type Context = Parameters<typeof deliverPasswordNotice>[0];
const USER = { id: "user-a", email: "private@example.test", emailVerified: false };
function context(path: string, returned: unknown) {
  return {
    path, body: { token: "reset-token" },
    context: { returned, internalAdapter: {
      findVerificationValue: vi.fn().mockResolvedValue({ value: USER.id }),
      findCredentialAccount: vi.fn().mockResolvedValue({ password: "stored-hash" }),
      findUserById: vi.fn().mockResolvedValue(USER),
    } },
  } as unknown as Context;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(revokeUserOAuthGrants).mockResolvedValue(2);
  vi.mocked(sendPasswordChangedNotice).mockResolvedValue(undefined);
});
it.each(["/change-password", "/reset-password"])("%s revokes before sending the notice", async path => {
  const ctx = context(path, path === "/change-password" ? { user: USER } : { status: true });
  await capturePasswordResetNotice(ctx);
  await deliverPasswordNotice(ctx);
  expect(revokeUserOAuthGrants).toHaveBeenCalledExactlyOnceWith(USER.id);
  expect(sendPasswordChangedNotice).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ userId: USER.id, email: USER.email }), true);
  expect(vi.mocked(revokeUserOAuthGrants).mock.invocationCallOrder[0])
    .toBeLessThan(vi.mocked(sendPasswordChangedNotice).mock.invocationCallOrder[0]);
});
it("says nothing about connected apps when there were none", async () => {
  vi.mocked(revokeUserOAuthGrants).mockResolvedValue(0);
  const ctx = context("/change-password", { user: USER });
  await deliverPasswordNotice(ctx);
  expect(sendPasswordChangedNotice).toHaveBeenCalledWith(expect.objectContaining({ userId: USER.id }), null);
});
it.each(["/change-password", "/reset-password"])("%s tolerates revocation failure and logs only the ID", async path => {
  vi.mocked(revokeUserOAuthGrants).mockRejectedValue(new Error(USER.email));
  const ctx = context(path, path === "/change-password" ? { user: USER } : { status: true });
  await capturePasswordResetNotice(ctx);
  await expect(deliverPasswordNotice(ctx)).resolves.toBeUndefined();
  expect(logger.warn).toHaveBeenCalledExactlyOnceWith({ userId: USER.id }, "connected apps were not disconnected");
  expect(sendPasswordChangedNotice).toHaveBeenCalledWith(expect.objectContaining({ userId: USER.id }), false);
});
it.each(["/change-password", "/reset-password"])("%s does not revoke on refusal", async path => {
  const ctx = context(path, new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD" }));
  await capturePasswordResetNotice(ctx);
  await deliverPasswordNotice(ctx);
  expect(revokeUserOAuthGrants).not.toHaveBeenCalled();
  expect(sendPasswordChangedNotice).not.toHaveBeenCalled();
});
it("revokes on first credential setup without sending a password-change notice", async () => {
  const ctx = context("/reset-password", { status: true });
  vi.mocked(ctx.context.internalAdapter.findCredentialAccount).mockResolvedValue(null);
  await capturePasswordResetNotice(ctx);
  await deliverPasswordNotice(ctx);
  expect(revokeUserOAuthGrants).toHaveBeenCalledExactlyOnceWith(USER.id);
  expect(sendPasswordChangedNotice).not.toHaveBeenCalled();
});
it("fails closed before reset if the follow-up identity cannot be read", async () => {
  const ctx = context("/reset-password", { status: true });
  vi.mocked(ctx.context.internalAdapter.findVerificationValue).mockRejectedValue(new Error(USER.email));
  await expect(capturePasswordResetNotice(ctx)).rejects.toThrow("Password reset security lookup failed");
  expect(revokeUserOAuthGrants).not.toHaveBeenCalled();
});
