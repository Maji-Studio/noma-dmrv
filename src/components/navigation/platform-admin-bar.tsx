/**
 * PlatformAdminBar: the persistent strip across the top of the app content
 * while a Platform Admin works inside an organization they do not belong to.
 * It pushes the page down rather than covering it, and its only action leaves
 * for the Platform home.
 */
import Link from "next/link";

export function PlatformAdminBar({ organizationName }: { organizationName: string }) {
  return (
    <div
      role="region"
      aria-label="Platform Admin"
      className="sticky top-56 z-20 shrink-0 md:static flex flex-wrap items-center justify-between gap-x-16 gap-y-4 bg-[var(--acc-infra-ink)] px-16 py-8 md:px-24 text-white"
    >
      <p className="body-small min-w-0">
        Platform Admin in <span className="font-medium">{organizationName}</span>
      </p>
      <Link
        href="/admin/organizations"
        className="body-small font-medium underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Back to Platform
      </Link>
    </div>
  );
}
