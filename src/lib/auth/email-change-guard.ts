import { getAuthoritativeSessionFromCtx, type createAuthMiddleware } from "better-auth/api";
import { verifyJWT } from "better-auth/crypto";
import { z } from "zod";
import { SETTINGS_PROFILE_HREF } from "@/lib/settings/links";

type MiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
const MILLISECONDS_PER_SECOND = 1000;
const verificationEmailPayload = z.object({
  email: z.email(),
  iat: z.number(),
  updateTo: z.email().optional(),
  requestType: z.string().optional(),
});

/** Shared by delivery and redemption; never trust an unsigned token payload. */
export async function readEmailVerificationToken(token: string, secret: string) {
  const payload = await verifyJWT<unknown>(token, secret);
  const parsed = verificationEmailPayload.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function refusalUrl(callbackURL: unknown, baseURL: string, code: string): string {
  let path = SETTINGS_PROFILE_HREF;
  // Only root-relative paths are allowed. Reject browser URL normalization
  // tricks (backslashes and control characters) before resolving the origin.
  if (typeof callbackURL === "string" && callbackURL.startsWith("/") &&
    !callbackURL.startsWith("//") && !callbackURL.includes("\\") &&
    !Array.from(callbackURL).some(char => char <= " " || char === "\u007f")) {
    const candidate = new URL(callbackURL, baseURL);
    if (candidate.origin === new URL(baseURL).origin && !candidate.pathname.startsWith("//")) path = callbackURL;
  }
  const url = new URL(path, baseURL);
  url.searchParams.set("error", code);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A mailbox link must never bootstrap a session for the account it changes. */
export async function guardEmailChangeVerification(ctx: MiddlewareContext): Promise<void> {
  if (typeof ctx.query?.token !== "string") return;
  const token = await readEmailVerificationToken(ctx.query.token, ctx.context.secret);
  // Invalid/expired tokens and ordinary verification retain Better Auth's handling.
  if (token?.requestType !== "change-email-verification") return;
  const session = await getAuthoritativeSessionFromCtx(ctx);
  let code = "SIGN_IN_REQUIRED";
  if (session) {
    if (session.user.email === token.email) {
      if (Math.floor(new Date(session.session.createdAt).getTime() / MILLISECONDS_PER_SECOND) <= token.iat) return;
      code = "INVALID_TOKEN";
    } else {
      // A consumed link may no longer resolve to a user. Use the same expired
      // refusal without revealing whether the old address still exists.
      const tokenUser = await ctx.context.internalAdapter.findUserByEmail(token.email);
      code = tokenUser && tokenUser.user.id !== session.user.id ? "WRONG_ACCOUNT" : "INVALID_TOKEN";
    }
  }
  // The authoritative lookup may clear a revoked cookie or refresh a different
  // user's cookie. Refusal must not emit either cookie mutation.
  ctx.responseHeaders.delete("set-cookie");
  throw ctx.redirect(refusalUrl(ctx.query?.callbackURL, ctx.context.baseURL, code));
}
