import { expect, it } from "vitest";
import { oauthRolePolicy, OAUTH_ROLE_POLICY } from "./oauth-role-policy";

it.each(["owner", "admin"])("allows %s to connect and manage all organization connections", role => {
  expect(oauthRolePolicy(role)).toEqual({ connect: true, manageOwn: true, manageAll: true });
});
it("allows Members to connect and disconnect only their own apps", () => {
  expect(oauthRolePolicy("member")).toEqual({ connect: true, manageOwn: true, manageAll: false });
});
it.each(["", "platform-admin", "viewer"])("refuses an unsupported role %j", role => {
  expect(oauthRolePolicy(role)).toEqual({ connect: false, manageOwn: false, manageAll: false });
});

it("can restrict connections to Owners and Admins with one policy setting", () => {
  expect(oauthRolePolicy("member", { ...OAUTH_ROLE_POLICY, memberConnections: false }).connect).toBe(false);
  expect(oauthRolePolicy("admin", { ...OAUTH_ROLE_POLICY, memberConnections: false }).connect).toBe(true);
});
it("can make management personal or restrict it to Owners and Admins", () => {
  expect(oauthRolePolicy("owner", { ...OAUTH_ROLE_POLICY, management: "personal" }).manageAll).toBe(false);
  expect(oauthRolePolicy("member", { ...OAUTH_ROLE_POLICY, management: "managers-only" }).manageOwn).toBe(false);
});
