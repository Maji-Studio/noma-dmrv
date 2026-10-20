/**
 * PlatformAdminBar: the persistent strip across the top of the app content
 * while a Platform Admin works inside an organization they do not belong to.
 * It pushes the page down rather than covering it (its height is the
 * `--platform-admin-bar-height` variable the layout sets), and its only action leaves
 * for the Platform home.
 */
import Link from "next/link";

/** Value for `--platform-admin-bar-height` while the bar renders (44px target). */
export const PLATFORM_ADMIN_BAR_HEIGHT = "44px";

export function PlatformAdminBar({ organizationName }: { organizationName: string }) {
  return (
    <div
      role="region"
      aria-label="Platform Admin"
      className="sticky top-56 z-20 flex h-[var(--platform-admin-bar-height)] shrink-0 items-center justify-between gap-16 bg-[var(--acc-infra-ink)] px-16 md:static md:px-24 text-white"
    >
      <p className="body-small min-w-0 truncate">
        Platform Admin in <span className="font-medium">{organizationName}</span>
      </p>
      <Link
        href="/admin/organizations"
        className="body-small inline-flex min-h-44 shrink-0 items-center font-medium underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Back to Platform
      </Link>
    </div>
  );
}
