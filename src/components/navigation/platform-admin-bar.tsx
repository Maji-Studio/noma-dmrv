/**
 * PlatformAdminBar (reads the viewer from context, so it vanishes while a stale
 * tab waits to reload): the persistent strip across the top of the app content
 * while a Platform Admin works inside an organization they do not belong to.
 * It pushes the page down rather than covering it (its height is the
 * `--platform-admin-bar-height` variable the layout sets), and its only action leaves
 * for the Platform home.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PLATFORM_HOME_HREF } from "@/lib/auth/home-path";
import { useViewerOrg } from "./viewer-org";
import { shouldShowPlatformAdminBar } from "./viewer-org-rules";

export function PlatformAdminBar() {
  const viewer = useViewerOrg();
  const pathname = usePathname();
  if (!viewer || !shouldShowPlatformAdminBar(viewer, pathname)) return null;
  return (
    <div
      role="region"
      aria-label="Platform Admin"
      className="sticky top-56 z-20 flex h-[var(--platform-admin-bar-height)] shrink-0 items-center justify-between gap-16 bg-[var(--clr-dark-purple)] px-16 md:static md:px-24 text-white"
    >
      <p className="body-small min-w-0 truncate">
        Platform Admin in <span className="font-medium">{viewer.organizationName}</span>
      </p>
      <Link
        href={PLATFORM_HOME_HREF}
        className="body-small inline-flex min-h-44 shrink-0 items-center font-medium underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Back to Platform
      </Link>
    </div>
  );
}
