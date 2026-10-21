/**
 * Pure rules for where the viewer is and as whom. No "use client", so the
 * server layout can call them as well as the sidebar.
 */
import type { OrgRole } from "@/lib/auth/server";
import { orgRoleLabel } from "@/lib/org-role-label";

/** Shown where no organization name is known yet. */
export const FALLBACK_ORG_NAME = "noma dMRV";

/** Value for `--platform-admin-bar-height` while the bar renders (a 44px target). */
export const PLATFORM_ADMIN_BAR_HEIGHT = "var(--spacing-44)";

export interface ViewerOrg {
  organizationId: string;
  organizationName: string;
  /** Membership role in the active organization; null without a membership. */
  orgRole: OrgRole | null;
  isPlatformAdmin: boolean;
}

/**
 * The chip text: the membership role only. A Platform Admin without a
 * membership gets no chip because the Platform Admin bar already says so; a
 * Platform Admin who is also a member keeps the membership chip.
 */
export function viewerRoleLabel(viewer: Pick<ViewerOrg, "orgRole">): string | null {
  return orgRoleLabel(viewer.orgRole);
}

/**
 * True when the shared session now points at another organization than the one
 * this page was rendered for (another tab switched). Unknown session org is
 * not a mismatch.
 */
export function isOrgMismatch(
  renderedOrganizationId: string | null,
  sessionOrganizationId: string | null | undefined,
): boolean {
  return Boolean(renderedOrganizationId && sessionOrganizationId && renderedOrganizationId !== sessionOrganizationId);
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
