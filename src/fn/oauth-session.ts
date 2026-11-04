import { OAUTH_RESTART_MESSAGE } from "@/config/oauth";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { env } from "@/config/env";
import { auth } from "@/lib/auth/better-auth";
import { getBetterAuthSession } from "@/lib/auth/providers/better-auth-server";
import { oauthAttemptIdentity } from "@/lib/auth/oauth-attempt";
import { findOAuthClient } from "@/data-access/oauth-credential-auth";
import { logger } from "@/lib/log";
import { SafeError } from "@/lib/errors";
import { ZodError } from "zod";
import { DomainError } from "@/lib/domain-errors";
import type { ActionResult } from "@/types/actions";
import { toActionFailure } from "./action-errors";

const OAUTH_ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AggregateError", "APIError"]);

export function refuseOAuthAction(): never {
  throw new DomainError("forbidden", OAUTH_RESTART_MESSAGE);
}

/** OAuth pages need a session, but never the session's active organization. */
export async function withOAuthSession<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (error) {
    if (!(error instanceof SafeError) && !(error instanceof ZodError)) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      logger.error({ errorName: error instanceof Error ? (OAUTH_ERROR_NAMES.has(error.name) ? error.name : "Error") : typeof error,
        code: typeof code === "string" && /^(?:[0-9A-Z]{5}|E[A-Z]+)$/.test(code) ? code : "unexpected_error" }, "OAuth action failed");
    }
    return toActionFailure(error, { fallbackMessage: OAUTH_RESTART_MESSAGE,
      log: { message: "OAuth action failed" }, logUnexpected: false });
  }
}

export async function verifiedOAuthRequest(oauthQuery: string) {
  if (!env.OAUTH_PROVIDER_ENABLED) refuseOAuthAction();
  const session = await getBetterAuthSession();
  if (!session?.user.emailVerified) refuseOAuthAction();
  if (!await verifyOAuthQueryParams(oauthQuery, (await auth.$context).secret)) refuseOAuthAction();
  const query = new URLSearchParams(oauthQuery);
  // Consent-page queries are signed for the session that cleared the picker.
  if (query.has("ba_pl") && query.get("ba_pl") !== session.session.id) refuseOAuthAction();
  const attempt = await oauthAttemptIdentity(session, query);
  const client = await findOAuthClient(attempt.clientId);
  if (!client || client.disabled) refuseOAuthAction();
  return { query, attempt, display: { clientName: client.name, clientHost: urlHost(attempt.clientId), redirectHost: urlHost(query.get("redirect_uri")!) } };
}

function urlHost(value: string): string | null {
  try { return new URL(value).host || null; } catch { return null; }
}
