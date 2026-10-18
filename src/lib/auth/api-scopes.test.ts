import { describe, expect, it } from "vitest";
import { API_SCOPES, principalAllows, hasScope, scopesFromPermissions, scopesFromStoredPermissions, serializeApiPermissions, toApiPermissions } from "./api-scopes";

describe("API authority", () => {
  it("round trips the exact v1 allowlist through plugin permissions", () => {
    expect(scopesFromPermissions(toApiPermissions(API_SCOPES))).toEqual(API_SCOPES);
    expect(toApiPermissions(["feedstocks:read", "feedstocks:read"])).toEqual({ feedstocks: ["read"] });
  });
  it("does not interpret wildcards or unknown permissions", () => {
    expect(scopesFromPermissions({ "*": ["*"], feedstocks: ["*"], facilities: ["write"] })).toEqual([]);
  });
  it.each(["owner", "admin", "member", null] as const)("intersects %s with scopes", (orgRole) => {
    expect(principalAllows({ principal: { kind: "api-key" }, orgRole, scopes: ["feedstocks:write"] }, "feedstocks:write"))
      .toBe(orgRole === "owner" || orgRole === "admin");
    expect(principalAllows({ principal: { kind: "api-key" }, orgRole, scopes: [] }, "feedstocks:write")).toBe(false);
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
  expect(principalAllows({ principal: { kind: "api-key" }, orgRole: "admin", scopes: [] }, "deliveries:write")).toBe(false);
  expect(principalAllows({ principal: { kind: "api-key" }, orgRole: "admin", scopes: ["deliveries:write"] }, "deliveries:write")).toBe(true);
  expect(principalAllows({ principal: { kind: "api-key" }, orgRole: "member", scopes: ["deliveries:write"] }, "deliveries:write")).toBe(false);
});

it("keeps application scopes independent and role restricted", () => {
  expect(scopesFromPermissions({ applications: ["read", "write", "delete"] })).toEqual(["applications:read", "applications:write", "applications:delete"]);
  expect(hasScope({ scopes: ["applications:write"] }, "applications:delete")).toBe(false);
  expect(hasScope({ scopes: ["applications:write"] }, "applications:read")).toBe(false);
  for (const scope of ["applications:write", "applications:delete"] as const) {
    expect(principalAllows({ principal: { kind: "api-key" }, orgRole: "member", scopes: [scope] }, scope)).toBe(false);
    expect(principalAllows({ principal: { kind: "api-key" }, orgRole: "admin", scopes: [] }, scope)).toBe(false);
    expect(principalAllows({ principal: { kind: "api-key" }, orgRole: "admin", scopes: [scope] }, scope)).toBe(true);
  }
});

it("recognizes independent formulation permissions", () => {
  expect(scopesFromPermissions({ formulations: ["read", "write", "delete"] })).toEqual(["formulations:read", "formulations:write", "formulations:delete"]);
  expect(principalAllows({ principal: { kind: "api-key" }, orgRole: "admin", scopes: ["formulations:read"] }, "formulations:write")).toBe(false);
  expect(principalAllows({ principal: { kind: "api-key" }, orgRole: "admin", scopes: ["formulations:write"] }, "formulations:delete")).toBe(false);
  expect(principalAllows({ principal: { kind: "api-key" }, orgRole: "admin", scopes: ["formulations:delete"] }, "formulations:write")).toBe(false);
});

it.each(["suppliers", "customers"] as const)("keeps %s mutation scopes independent", entity => {
  expect(scopesFromPermissions({ [entity]: ["read", "write", "delete"] })).toEqual([`${entity}:read`, `${entity}:write`, `${entity}:delete`]);
  expect(principalAllows({ principal: { kind: "api-key" }, orgRole: "admin", scopes: [`${entity}:read`] }, `${entity}:write`)).toBe(false);
  expect(principalAllows({ principal: { kind: "api-key" }, orgRole: "admin", scopes: [`${entity}:delete`] }, `${entity}:write`)).toBe(false);
});

it("allows Member OAuth read/write, never deletes, while Member keys remain refused", () => {
  const context = { orgRole: "member" as const, scopes: [...API_SCOPES], principal: { kind: "oauth" as const } };
  expect(principalAllows(context, "feedstocks:write")).toBe(true);
  expect(principalAllows(context, "feedstocks:delete")).toBe(false);
});
