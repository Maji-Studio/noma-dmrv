import { describe, expect, it } from "vitest";
import type { OrgRole } from "@/lib/auth/server";
import { shouldShowPlatformAdminBar, viewerRoleLabel } from "./viewer-org-rules";

describe("viewerRoleLabel", () => {
  it.each<[OrgRole, string]>([
    ["owner", "Owner"],
    ["admin", "Admin"],
    ["member", "Member"],
  ])("labels the %s membership", (orgRole, label) => {
    expect(viewerRoleLabel({ orgRole, isPlatformAdmin: false })).toBe(label);
  });

  it("calls a Platform Admin without a membership Platform Admin", () => {
    expect(viewerRoleLabel({ orgRole: null, isPlatformAdmin: true })).toBe("Platform Admin");
  });

  it("shows the membership role for a Platform Admin who is also a member", () => {
    expect(viewerRoleLabel({ orgRole: "member", isPlatformAdmin: true })).toBe("Member");
  });

  it("has no label without a role or Platform Admin standing", () => {
    expect(viewerRoleLabel({ orgRole: null, isPlatformAdmin: false })).toBeNull();
  });
});

describe("shouldShowPlatformAdminBar", () => {
  it("shows for a Platform Admin without a membership", () => {
    expect(shouldShowPlatformAdminBar({ orgRole: null, isPlatformAdmin: true })).toBe(true);
  });

  it("hides for a Platform Admin who is also a member", () => {
    expect(shouldShowPlatformAdminBar({ orgRole: "admin", isPlatformAdmin: true })).toBe(false);
  });

  it("never shows for members", () => {
    expect(shouldShowPlatformAdminBar({ orgRole: "member", isPlatformAdmin: false })).toBe(false);
  });

  it("hides without a viewer", () => {
    expect(shouldShowPlatformAdminBar(null)).toBe(false);
  });
});
