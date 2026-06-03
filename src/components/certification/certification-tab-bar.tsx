/**
 * CertificationTabBar
 * Route-segment tabs for the certification workspace, mounted in the shared
 * layout. Each tab is a real route (deep-linkable, server-loadable, keeps its
 * own error boundary) rather than client tab state — there is no `ui/tabs`
 * primitive. Active state uses `usePathname` with a prefix match so the nested
 * removal review route (Stage 4) keeps "Removals" highlighted. The active
 * `?facility=` scope is preserved on every tab, mirroring the sidebar's
 * NavLink, so switching tabs never drops the selected facility.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { cn } from "@/lib/utils";

interface CertificationTab {
  href: string;
  label: string;
}

const TABS: CertificationTab[] = [
  { href: "/certification", label: "Overview" },
  { href: "/certification/removals", label: "Removals" },
  { href: "/certification/ghg-statements", label: "GHG Statements" },
  { href: "/certification/settings", label: "Settings" },
];

function isTabActive(pathname: string, href: string): boolean {
  // Overview is the section root and a prefix of every other tab — exact only.
  if (href === "/certification") return pathname === "/certification";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CertificationTabBar() {
  const pathname = usePathname();
  const { facilityId } = useFacilityContext();

  return (
    <nav
      aria-label="Certification sections"
      className="flex items-stretch gap-4 border-b border-[var(--color-border-secondary)]"
    >
      {TABS.map((tab) => {
        const active = isTabActive(pathname, tab.href);
        const href = facilityId
          ? `${tab.href}?facility=${facilityId}`
          : tab.href;
        return (
          <Link
            key={tab.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center px-12 h-40 body-small transition-colors duration-150",
              active
                ? "text-[var(--color-text-primary)]"
                : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]",
            )}
          >
            {tab.label}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-[-1px] h-[2px] bg-[var(--clr-pink)]"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
