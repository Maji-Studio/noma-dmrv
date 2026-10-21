import { expect, it } from "vitest";
import { orgRoleSchema } from "./organizations";
import { canOwnApiKey } from "@/lib/auth/api-scopes";
import { oauthRolePolicy } from "@/lib/auth/oauth-role-policy";

it.each(["admin", "member"])("accepts the organization role %s", role => {
  expect(orgRoleSchema.parse(role)).toBe(role);
});
it.each(["owner", "admin,member", "", "viewer"])("refuses the unsupported organization role %s", role => {
  expect(orgRoleSchema.safeParse(role).success).toBe(false);
  expect(canOwnApiKey(role)).toBe(false);
  expect(oauthRolePolicy(role)).toEqual({ connect: false, manageOwn: false, manageAll: false });
});
