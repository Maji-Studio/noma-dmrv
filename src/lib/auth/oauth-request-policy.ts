import { OAUTH_RESTART_MESSAGE } from "@/config/oauth";
import { APIError } from "better-auth/api";
import { MILLISECONDS_PER_SECOND } from "@/config/api-keys";
import { OAUTH_REFRESH_REPLAY_SECONDS } from "@/config/oauth";
import { parseOAuthScopes } from "./oauth-scopes";

export const OAUTH_HTTP_PATHS = new Set([
  "/oauth2/authorize", "/oauth2/token", "/oauth2/consent", "/oauth2/continue", "/oauth2/revoke",
]);

export function refuseOAuth(error: string, description = OAUTH_RESTART_MESSAGE): never {
  throw new APIError("BAD_REQUEST", { error, error_description: description });
}

export function guardOAuthResource(resource: unknown): void {
  if (Array.isArray(resource) && resource.length !== 1) refuseOAuth("invalid_target");
}

export function guardOAuthAuthorize(query: Record<string, unknown>): void {
  guardOAuthResource(query.resource);
  if (query.dpop_jkt !== undefined) refuseOAuth("invalid_request", "DPoP is not supported");
  try { parseOAuthScopes(typeof query.scope === "string" ? query.scope : ""); }
  catch { refuseOAuth("invalid_scope"); }
}

export function guardOAuthTokenInput(body: Record<string, unknown>, headers?: Headers): void {
  guardOAuthResource(body.resource);
  if (body.grant_type === "client_credentials") refuseOAuth("unsupported_grant_type");
  if (headers?.has("dpop")) refuseOAuth("invalid_request", "DPoP is not supported");
}

/** Logout revokes refresh rows without offline_access through a path our hook
 * cannot serialise, so no refresh row may ever lack it: refuse a refresh that
 * would drop it, and refuse a row that already lacks it. */
export function guardOAuthRefreshScopes(requested: unknown, rowScopes: readonly string[]): void {
  if (!rowScopes.includes("offline_access")) refuseOAuth("invalid_grant");
  if (typeof requested === "string" && !requested.split(" ").includes("offline_access")) refuseOAuth("invalid_scope");
}

export function refreshDecision(row: { revoked: Date | null; rotatedAt: Date | null }, now: Date) {
  if (row.revoked && !row.rotatedAt) return "refuse";
  if (row.rotatedAt && now.getTime() - row.rotatedAt.getTime() > OAUTH_REFRESH_REPLAY_SECONDS * MILLISECONDS_PER_SECOND) return "reuse";
  return "pass";
}
