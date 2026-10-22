import { describe, expect, it } from "vitest";
import type { OrgRole } from "@/lib/auth/server";
import { isOrgMismatch, shouldShowPlatformAdminBar, viewerRoleLabel } from "./viewer-org-rules";

describe("viewerRoleLabel", () => {
  it.each<[OrgRole, string]>([
    ["admin", "Admin"],
    ["member", "Member"],
  ])("labels the %s membership", (orgRole, label) => {
    expect(viewerRoleLabel({ orgRole })).toBe(label);
  });

  it("gives a Platform Admin without a membership no chip (the bar says it)", () => {
    expect(viewerRoleLabel({ orgRole: null })).toBeNull();
  });
});

describe("shouldShowPlatformAdminBar", () => {
  it("shows for a Platform Admin without a membership", () => {
    expect(shouldShowPlatformAdminBar({ orgRole: null, isPlatformAdmin: true }, "/dashboard")).toBe(true);
  });

  it("hides for a Platform Admin who is also a member", () => {
    expect(shouldShowPlatformAdminBar({ orgRole: "admin", isPlatformAdmin: true }, "/dashboard")).toBe(false);
  });

  it("never shows for members", () => {
    expect(shouldShowPlatformAdminBar({ orgRole: "member", isPlatformAdmin: false }, "/dashboard")).toBe(false);
  });

  it("hides without a viewer", () => {
    expect(shouldShowPlatformAdminBar(null, "/dashboard")).toBe(false);
  });

  it.each(["/admin", "/admin/organizations"])("hides on the Platform page %s", (path) => {
    expect(shouldShowPlatformAdminBar({ orgRole: null, isPlatformAdmin: true }, path)).toBe(false);
  });

  it("keeps showing on pages that only start with the same letters", () => {
    expect(shouldShowPlatformAdminBar({ orgRole: null, isPlatformAdmin: true }, "/administration")).toBe(true);
  });
});

describe("isOrgMismatch", () => {
  it("is true when the session moved to another organization", () => {
    expect(isOrgMismatch("org-1", "org-2")).toBe(true);
  });

  it("is false when they agree or the session organization is unknown", () => {
    expect(isOrgMismatch("org-1", "org-1")).toBe(false);
    expect(isOrgMismatch("org-1", null)).toBe(false);
    expect(isOrgMismatch("org-1", undefined)).toBe(false);
    expect(isOrgMismatch(null, "org-2")).toBe(false);
  });
});
