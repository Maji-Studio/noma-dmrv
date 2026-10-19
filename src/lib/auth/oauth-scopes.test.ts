import { expect, it } from "vitest";
import { API_SCOPES } from "./api-scopes";
import { OAUTH_GRANTABLE_SCOPES, OAUTH_READ_SCOPES, oauthRoleCeiling, parseOAuthScopes } from "./oauth-scopes";

it("grants every read and write, never deletes or identity scopes", () => {
  expect([...OAUTH_GRANTABLE_SCOPES]).toEqual(API_SCOPES.filter(scope => !scope.endsWith(":delete")));
  expect(OAUTH_READ_SCOPES).toEqual(API_SCOPES.filter(scope => scope.endsWith(":read")));
});
it.each(["owner", "admin", "member"])("allows %s the grantable ceiling", role => {
  expect(oauthRoleCeiling(role)).toEqual(OAUTH_GRANTABLE_SCOPES);
});
it("honors the role policy and denies unknown roles", () => {
  expect(oauthRoleCeiling("member", { memberConnections: false, management: "organization" }).size).toBe(0);
  expect(oauthRoleCeiling("platform-admin").size).toBe(0);
});
it("parses scopes, deduplicates and preserves offline access without accepting unknown scopes", () => {
  expect(parseOAuthScopes("feedstocks:read offline_access feedstocks:read")).toEqual(["feedstocks:read", "offline_access"]);
  expect(parseOAuthScopes("")).toEqual([]);
  for (const scope of ["*", "openid", "feedstocks:delete", "made-up:read"]) expect(() => parseOAuthScopes(scope)).toThrow("invalid_scope");
});
