import type { createAuthMiddleware } from "better-auth/api";
import { z } from "zod";
import { sendPasswordChangedNotice } from "@/lib/email/account-notices";
import { logger } from "@/lib/log";

type MiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
const changedPasswordResult = z.object({ user: z.object({ id: z.string(), email: z.string() }) });
const resetPasswordResult = z.object({ status: z.literal(true) });
type NoticeContext = MiddlewareContext["context"] & {
  // Better Auth clones context between before/after hooks, so keep the value
  // on that request's context rather than keying a WeakMap by object identity.
  passwordResetNotice?: { userId: string; email: string };
};

/** Capture before reset consumes its token; first-time credential setup is excluded. */
export async function capturePasswordResetNotice(ctx: MiddlewareContext): Promise<void> {
  if (ctx.path !== "/reset-password") return;
  try {
    // org-scope-ok: pre-sign-in password reset is account-wide; this Better Auth hook has no OrgContext.
    const token = ctx.body?.token || ctx.query?.token;
    if (!token) return;
    const verification = await ctx.context.internalAdapter.findVerificationValue(`reset-password:${token}`);
    if (!verification) return;
    const credential = await ctx.context.internalAdapter.findCredentialAccount(verification.value);
    if (!credential?.password) return;
    const user = await ctx.context.internalAdapter.findUserById(verification.value);
    if (user) (ctx.context as NoticeContext).passwordResetNotice = { userId: user.id, email: user.email };
  } catch {
    logger.error({}, "password notice eligibility lookup failed");
  }
}

/** Endpoint after-hooks run after Better Auth's credential transaction commits. */
export async function deliverPasswordNotice(ctx: MiddlewareContext): Promise<void> {
  if (ctx.path === "/change-password") {
    const result = changedPasswordResult.safeParse(ctx.context.returned);
    if (result.success) {
      await sendPasswordChangedNotice({ userId: result.data.user.id, email: result.data.user.email });
    }
  } else if (ctx.path === "/reset-password") {
    const context = ctx.context as NoticeContext;
    const recipient = context.passwordResetNotice;
    delete context.passwordResetNotice;
    if (recipient && resetPasswordResult.safeParse(ctx.context.returned).success) {
      await sendPasswordChangedNotice(recipient);
    }
  }
}
