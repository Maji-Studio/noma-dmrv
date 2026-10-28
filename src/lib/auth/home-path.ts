export const PLATFORM_HOME_HREF = "/platform/organizations";
export const MEMBER_HOME_HREF = "/dashboard";

/** The session user's global role determines their default landing page. */
export function homePathFor(user: { role?: string | null } | null | undefined): string {
  return user?.role === "admin" ? PLATFORM_HOME_HREF : MEMBER_HOME_HREF;
}

/** True on the Platform pages themselves (`/platform` and below). */
export function isPlatformPath(pathname: string | null | undefined): boolean {
  return pathname === "/platform" || Boolean(pathname?.startsWith("/platform/"));
}
