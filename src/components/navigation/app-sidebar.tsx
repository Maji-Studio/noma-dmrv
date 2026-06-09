/**
 * App Sidebar — desktop chrome.
 *
 * A 240px sticky dark rail, hidden below `md` where the mobile top bar +
 * drawer (mobile-nav.tsx) takes over. All nav rendering lives in the shared
 * `SidebarContent` so desktop and mobile stay identical.
 */
"use client";

import { SidebarContent } from "./sidebar-content";

export function AppSidebar() {
  return (
    <aside className="hidden md:flex w-[240px] shrink-0 h-screen sticky top-0 flex-col">
      <SidebarContent />
    </aside>
  );
}
