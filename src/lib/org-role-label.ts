/**
 * The words an operator sees for an organization role. One place, so a change
 * to the role set (Owner merging into Admin) is one edit here.
 */
export const PLATFORM_ADMIN_LABEL = "Platform Admin";

const ORG_ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** Label for a membership role; null for an unknown or missing role. */
export function orgRoleLabel(role: string | null | undefined): string | null {
  return role ? (ORG_ROLE_LABELS[role] ?? null) : null;
}
