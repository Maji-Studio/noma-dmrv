import { describe, expect, it } from "vitest";
import { API_SCOPES, hasRoleAndScope, hasScope, scopesFromPermissions, scopesFromStoredPermissions, serializeApiPermissions, toApiPermissions } from "./api-scopes";

describe("API authority", () => {
  it("round trips the exact v1 allowlist through plugin permissions", () => {
    expect(scopesFromPermissions(toApiPermissions(API_SCOPES))).toEqual(API_SCOPES);
    expect(toApiPermissions(["feedstocks:read", "feedstocks:read"])).toEqual({ feedstocks: ["read"] });
  });
  it("does not interpret wildcards or unknown permissions", () => {
    expect(scopesFromPermissions({ "*": ["*"], feedstocks: ["*"], facilities: ["write"] })).toEqual([]);
  });
  it.each(["owner", "admin", "member", null] as const)("intersects %s with scopes", (orgRole) => {
    expect(hasRoleAndScope({ orgRole, scopes: ["feedstocks:write"] }, "feedstocks:write"))
      .toBe(orgRole === "owner" || orgRole === "admin");
    expect(hasRoleAndScope({ orgRole, scopes: [] }, "feedstocks:write")).toBe(false);
  });
  it("does not imply read or delete from write", () => {
    expect(hasScope({ scopes: ["feedstocks:write"] }, "feedstocks:delete")).toBe(false);
    expect(hasScope({ scopes: ["feedstocks:write"] }, "feedstocks:read")).toBe(false);
  });
});

it("uses the plugin JSON storage format and shared stored permission decoder", () => {
  expect(serializeApiPermissions(["feedstocks:read"])).toBe('{"feedstocks":["read"]}');
  expect(scopesFromStoredPermissions(serializeApiPermissions(API_SCOPES))).toEqual(API_SCOPES);
  expect(scopesFromStoredPermissions(null)).toEqual([]);
  expect(scopesFromStoredPermissions('{"feedstocks":["*","read"]}')).toEqual(["feedstocks:read"]);
  expect(() => scopesFromStoredPermissions("invalid JSON")).toThrow();
});
