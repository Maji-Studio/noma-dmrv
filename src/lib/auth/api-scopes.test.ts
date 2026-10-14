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

it("allows customer and order scopes without implying reads or deletes from an order write", () => {
  expect(API_SCOPES).toEqual(expect.arrayContaining(["customers:read", "orders:read", "orders:write", "orders:delete"]));

  expect(hasScope({ scopes: ["orders:write"] }, "orders:read")).toBe(false);
  expect(hasScope({ scopes: ["orders:write"] }, "orders:delete")).toBe(false);
});

it("offers delivery writes only by explicit scope, with no delete capability", () => {
  expect(scopesFromPermissions({ deliveries: ["read", "write", "delete"] })).toEqual(["deliveries:read", "deliveries:write"]);
  expect(hasScope({ scopes: ["deliveries:write"] }, "deliveries:read")).toBe(false);
  expect(hasRoleAndScope({ orgRole: "admin", scopes: [] }, "deliveries:write")).toBe(false);
  expect(hasRoleAndScope({ orgRole: "admin", scopes: ["deliveries:write"] }, "deliveries:write")).toBe(true);
  expect(hasRoleAndScope({ orgRole: "member", scopes: ["deliveries:write"] }, "deliveries:write")).toBe(false);
});
