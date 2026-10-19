import type { ApiContext } from "@/lib/auth/api-context";

/** The credential is the OAuth generation, shared by its access tokens. */
export function apiAudit(ctx: ApiContext, requestId: string, transport: "rest" | "mcp") {
  return {
    requestId, credentialId: ctx.credentialId, transport,
    oauthClientId: ctx.principal.kind === "oauth" ? ctx.principal.oauthClientId : undefined,
  };
}
