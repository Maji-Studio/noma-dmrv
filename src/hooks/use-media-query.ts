/**
 * Media-query hooks — SSR-safe via `useSyncExternalStore`.
 *
 * The server snapshot is always `false`: the server has no viewport, and
 * defaulting to the desktop layout (then correcting on the client) avoids
 * a hydration mismatch on the markup that ships in the HTML. Components that
 * branch on `useIsMobile()` therefore render the desktop tree on the server
 * and swap to mobile after hydration — acceptable here because the mobile
 * shell (top bar + drawer) is purely client-interactive anyway.
 */
"use client";

import { useSyncExternalStore } from "react";

/** Default mobile breakpoint — matches Tailwind's `md` (everything below is "mobile"). */
export const MOBILE_BREAKPOINT_PX = 768;

function subscribe(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  };
}

/**
 * Returns `true` when the viewport matches `query` (a CSS media query string).
 * Always `false` during SSR and the first client render before hydration.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Returns `true` on viewports narrower than `breakpoint` (default 768px / `md`).
 * Use to switch between the desktop sidebar and the mobile top-bar + drawer.
 */
export function useIsMobile(breakpoint: number = MOBILE_BREAKPOINT_PX): boolean {
  return useMediaQuery(`(max-width: ${breakpoint - 1}px)`);
}
