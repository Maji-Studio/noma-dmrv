import { API_SCOPES, type ApiScope } from "./api-scope-values";
import { oauthRolePolicy, OAUTH_ROLE_POLICY } from "./oauth-role-policy";

export const OAUTH_GRANTABLE_SCOPES: ReadonlySet<ApiScope> = new Set(API_SCOPES.filter(scope => scope.endsWith(":read") || scope.endsWith(":write")));
export const OAUTH_READ_SCOPES = API_SCOPES.filter(scope => scope.endsWith(":read"));
export type OAuthScope = ApiScope | "offline_access";

export function oauthRoleCeiling(role: string | null, policy = OAUTH_ROLE_POLICY): ReadonlySet<ApiScope> {
  return oauthRolePolicy(role ?? "", policy).connect ? OAUTH_GRANTABLE_SCOPES : new Set();
}

/** Authorize rejects unknown scopes rather than silently widening consent. */
export function parseOAuthScopes(value: string): OAuthScope[] {
  const scopes = value.trim() ? [...new Set(value.trim().split(/\s+/))] : [];
  if (scopes.some(scope => scope !== "offline_access" && !OAUTH_GRANTABLE_SCOPES.has(scope as ApiScope))) {
    throw new Error("invalid_scope");
  }
  return scopes as OAuthScope[];
}
