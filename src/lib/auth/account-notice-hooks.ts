import type { createAuthMiddleware } from "better-auth/api";
import { revokeUserOAuthGrants } from "@/data-access/oauth-grant-lifecycle";
import { z } from "zod";
import { sendPasswordChangedNotice } from "@/lib/email/account-notices";
import { logger } from "@/lib/log";

type MiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
const changedPasswordResult = z.object({ user: z.object({ id: z.string(), email: z.string() }) });
const resetPasswordResult = z.object({ status: z.literal(true) });
type NoticeContext = MiddlewareContext["context"] & {
  // Better Auth clones context between before/after hooks, so keep the value
  // on that request's context rather than keying a WeakMap by object identity.
  passwordResetNotice?: { userId: string; email: string; sendNotice: boolean };
};

/** Capture before reset consumes its token; first-time setup omits only the notice. */
export async function capturePasswordResetNotice(ctx: MiddlewareContext): Promise<void> {
  if (ctx.path !== "/reset-password") return;
  try {
    // org-scope-ok: pre-sign-in password reset is account-wide; this Better Auth hook has no OrgContext.
    const token = ctx.body?.token || ctx.query?.token;
    if (!token) return;
    const verification = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
    if (!verification) return;
    const credential = await ctx.context.internalAdapter.findCredentialAccount(verification.value);
    const user = await ctx.context.internalAdapter.findUserById(verification.value);
    if (user) (ctx.context as NoticeContext).passwordResetNotice = { userId: user.id, email: user.email, sendNotice: Boolean(credential?.password) };
  } catch {
    // Refuse before the password write if its security follow-up cannot be identified.
    throw new Error("Password reset security lookup failed");
  }
}

/** Endpoint after-hooks run after Better Auth's credential transaction commits. */
export async function deliverPasswordNotice(ctx: MiddlewareContext): Promise<void> {
  if (ctx.path === "/change-password") {
    const result = changedPasswordResult.safeParse(ctx.context.returned);
    if (result.success) {
      await finishPasswordChange({ userId: result.data.user.id, email: result.data.user.email });
    }
  } else if (ctx.path === "/reset-password") {
    const context = ctx.context as NoticeContext;
    const recipient = context.passwordResetNotice;
    delete context.passwordResetNotice;
    if (recipient && resetPasswordResult.safeParse(ctx.context.returned).success) {
      await finishPasswordChange(recipient, recipient.sendNotice);
    }
  }
}

/** Runs only after a successful credential commit; failures cannot undo it. */
async function finishPasswordChange(recipient: { userId: string; email: string }, sendNotice = true) {
  let connectedAppsDisconnected = false;
  try {
    await revokeUserOAuthGrants(recipient.userId);
    connectedAppsDisconnected = true;
  } catch {
    logger.warn({ userId: recipient.userId }, "connected apps were not disconnected");
  }
  if (sendNotice) await sendPasswordChangedNotice(recipient, connectedAppsDisconnected);
}
