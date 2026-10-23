import { getAuthoritativeSessionFromCtx, type createAuthMiddleware } from "better-auth/api";
import { verifyJWT } from "better-auth/crypto";
import { z } from "zod";
import { SETTINGS_PROFILE_HREF } from "@/lib/settings/links";

type MiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
const verificationEmailPayload = z.object({
  email: z.email(),
  updateTo: z.email().optional(),
  requestType: z.string().optional(),
});

/** Shared by delivery and redemption; never trust an unsigned token payload. */
export async function readEmailVerificationToken(token: string, secret: string) {
  const payload = await verifyJWT<unknown>(token, secret);
  const parsed = verificationEmailPayload.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function signInRequiredUrl(callbackURL: unknown, baseURL: string): string {
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
  url.searchParams.set("error", "SIGN_IN_REQUIRED");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** A mailbox link must never bootstrap a session for the account it changes. */
export async function guardEmailChangeVerification(ctx: MiddlewareContext): Promise<void> {
  if (typeof ctx.query?.token !== "string") return;
  const token = await readEmailVerificationToken(ctx.query.token, ctx.context.secret);
  // Invalid/expired tokens and ordinary verification retain Better Auth's handling.
  if (token?.requestType !== "change-email-verification") return;
  const session = await getAuthoritativeSessionFromCtx(ctx);
  if (session?.user.email === token.email) return;
  // The authoritative lookup may clear a revoked cookie or refresh a different
  // user's cookie. Refusal must not emit either cookie mutation.
  ctx.responseHeaders.delete("set-cookie");
  throw ctx.redirect(signInRequiredUrl(ctx.query?.callbackURL, ctx.context.baseURL));
}
