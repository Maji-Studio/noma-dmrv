export const PLATFORM_HOME_HREF = "/admin/organizations";
export const MEMBER_HOME_HREF = "/dashboard";

/** The session user's global role determines their default landing page. */
export function homePathFor(user: { role?: string | null } | null | undefined): string {
  return user?.role === "admin" ? PLATFORM_HOME_HREF : MEMBER_HOME_HREF;
}
