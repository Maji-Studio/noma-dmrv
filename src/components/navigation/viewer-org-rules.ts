/**
 * Pure rules for where the viewer is and as whom. No "use client", so the
 * server layout can call them as well as the sidebar.
 */
import type { OrgRole } from "@/lib/auth/server";
import { orgRoleLabel, PLATFORM_ADMIN_LABEL } from "@/lib/org-role-label";

export interface ViewerOrg {
  organizationId: string;
  organizationName: string;
  /** Membership role in the active organization; null without a membership. */
  orgRole: OrgRole | null;
  isPlatformAdmin: boolean;
}

/** The chip text: the membership role, or "Platform Admin" without one. */
export function viewerRoleLabel(
  viewer: Pick<ViewerOrg, "orgRole" | "isPlatformAdmin">,
): string | null {
  return orgRoleLabel(viewer.orgRole) ?? (viewer.isPlatformAdmin ? PLATFORM_ADMIN_LABEL : null);
}

/**
 * The Platform Admin bar shows only while a Platform Admin works in an
 * organization they do not belong to. A Platform Admin who is also a member
 * acts as that member and sees no bar. Never rank `orgRole` here: it is null
 * for a Platform Admin without a membership.
 */
export function shouldShowPlatformAdminBar(
  viewer: Pick<ViewerOrg, "orgRole" | "isPlatformAdmin"> | null,
): boolean {
  return Boolean(viewer?.isPlatformAdmin && !viewer.orgRole);
}
