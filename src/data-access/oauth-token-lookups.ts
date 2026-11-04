import type { DBAdapter } from "better-auth";
import type { OAuthRefreshToken, OAuthOpaqueAccessToken } from "@better-auth/oauth-provider";

// org-scope-ok: pre-authentication token lookup establishes the grant organization
export async function findOAuthAuthorizationCode(adapter: DBAdapter, codeHash: string) {
  return adapter.findOne<{ value: string }>({ model: "verification",
    where: [{ field: "identifier", value: codeHash }] });
}

// org-scope-ok: pre-authentication token lookup establishes the grant organization
export async function findOAuthRefreshToken(adapter: DBAdapter, tokenHash: string) {
  return adapter.findOne<OAuthRefreshToken>({ model: "oauthRefreshToken",
    where: [{ field: "token", value: tokenHash }] });
}

// org-scope-ok: pre-authentication token lookup establishes the grant organization
export async function findOAuthRevocationToken(adapter: DBAdapter, tokenHash: string, refresh: boolean) {
  return adapter.findOne<OAuthRefreshToken | OAuthOpaqueAccessToken>({
    model: refresh ? "oauthRefreshToken" : "oauthAccessToken",
    where: [{ field: "token", value: tokenHash }],
  });
}
