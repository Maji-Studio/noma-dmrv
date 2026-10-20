import type { ApiContext } from "@/lib/auth/api-context";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { logger } from "@/lib/log";
import { apiDenialResponse, oauthStepUpChallengeApplies } from "./problem";

/** Persist the refused operation before returning its challenge, across REST and MCP. */
export async function apiScopeDenialResponse(ctx: ApiContext, instance: string, requestId: string, requiredScopes: readonly ApiScope[]) {
  const challenge = {
    oauth: ctx.principal.kind === "oauth", role: ctx.orgRole, scopes: ctx.scopes, requiredScopes,
  };
  const response = apiDenialResponse("missing_scope", instance, requestId, challenge);
  if (ctx.principal.kind === "oauth" && oauthStepUpChallengeApplies("missing_scope", challenge)) {
    try {
      const { recordOAuthStepUp } = await import("@/data-access/oauth-step-up");
      await recordOAuthStepUp({ userId: ctx.userId, clientId: ctx.principal.oauthClientId, organizationId: ctx.organizationId }, requiredScopes);
    } catch {
      // A consent preselection hint must never change the scope refusal.
      logger.warn({ op: "oauth.recordStepUp", requestId, userId: ctx.userId, clientId: ctx.principal.oauthClientId,
        organizationId: ctx.organizationId }, "OAuth step-up hint recording failed");
    }
  }
  return response;
}
