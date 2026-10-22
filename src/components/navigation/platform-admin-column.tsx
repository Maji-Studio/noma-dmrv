/**
 * PlatformAdminColumn: the app content column. The Platform Admin bar sits
 * above `main`, inside this column, so it pushes the page down instead of
 * covering it. The column sets `--platform-admin-bar-height` under the same
 * rule the bar renders by, which needs the page path, so it is a client
 * component.
 */
"use client";

import { usePathname } from "next/navigation";
import { PlatformAdminBar } from "./platform-admin-bar";
import { useViewerOrg } from "./viewer-org";
import { PLATFORM_ADMIN_BAR_HEIGHT, shouldShowPlatformAdminBar } from "./viewer-org-rules";

export function PlatformAdminColumn({ children }: { children: React.ReactNode }) {
  const viewer = useViewerOrg();
  const showBar = shouldShowPlatformAdminBar(viewer, usePathname());
  return (
    <div
      className="flex flex-1 min-w-0 flex-col md:min-h-0"
      style={
        showBar
          ? ({ "--platform-admin-bar-height": PLATFORM_ADMIN_BAR_HEIGHT } as React.CSSProperties)
          : undefined
      }
    >
      <PlatformAdminBar />
      <main id="main-content" tabIndex={-1} className="flex-1 min-h-0 min-w-0 overflow-auto focus:outline-none">
        {children}
      </main>
    </div>
  );
}
