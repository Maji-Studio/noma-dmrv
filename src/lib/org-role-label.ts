/**
 * The words an operator sees for an organization role. One place, so a change
 * to the role set is one edit here.
 */
import type { OrgRole } from "@/lib/auth/server";

const ORG_ROLE_LABELS = {
  admin: "Admin",
  member: "Member",
} as const satisfies Record<OrgRole, string>;

export type OrgRoleLabel = (typeof ORG_ROLE_LABELS)[OrgRole];

/** Label for a known membership role. */
export function orgRoleLabelOf(role: OrgRole): OrgRoleLabel {
  return ORG_ROLE_LABELS[role];
}

/** Label for a membership role; null for an unknown or missing role. */
export function orgRoleLabel(role: OrgRole | null | undefined): OrgRoleLabel | null {
  return role ? orgRoleLabelOf(role) : null;
}
