import type { ApiContext } from "@/lib/auth/api-context";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { apiDenialResponse } from "./problem";

/** Persist the refused operation before returning its challenge, across REST and MCP. */
export async function apiScopeDenialResponse(ctx: ApiContext, instance: string, requestId: string, requiredScopes: readonly ApiScope[]) {
  const response = apiDenialResponse("missing_scope", instance, requestId, {
    oauth: ctx.principal.kind === "oauth", role: ctx.orgRole, scopes: ctx.scopes, requiredScopes,
  });
  if (ctx.principal.kind === "oauth" && response.headers.get("www-authenticate")?.includes('error="insufficient_scope"')) {
    try {
      const { recordOAuthStepUp } = await import("@/data-access/oauth-step-up");
      await recordOAuthStepUp({ userId: ctx.userId, clientId: ctx.principal.oauthClientId, organizationId: ctx.organizationId }, requiredScopes);
    } catch {
      // A consent preselection hint must never change the scope refusal.
    }
  }
  return response;
}
