/**
 * SidebarContent — the brand header + facility selector + grouped nav + footer.
 *
 * Rendered by BOTH the desktop `<aside>` (app-sidebar.tsx) and the mobile
 * right-side drawer (mobile-nav.tsx), so the section list, active-state logic,
 * registry gating, and admin gating live in exactly one place. The dark
 * gradient background lives here too, so both surfaces look identical.
 *
 * `onNavigate` is called whenever the user activates a nav link or a footer
 * action; the mobile drawer passes a close handler so the drawer dismisses on
 * navigation. The desktop aside omits it (the sidebar is always present).
 */
"use client";

import { type ElementType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  House,
  TreeStructure,
  Leaf,
  Factory,
  Handshake,
  Users,
  Truck,
  Cube,
  Flask,
  Package,
  ShoppingCart,
  MapPin,
  Certificate,
  Stack,
  FileText,
  TestTube,
  ListChecks,
  Lightning,
  GearSix,
  SignOut,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { useAuth, authClient } from "@/lib/auth/client";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { FacilitySelector } from "./facility-selector";
import { useFacilityContext } from "@/hooks/use-facility-context";

interface NavItem {
  href: string;
  label: string;
  icon: ElementType;
  /** Skip appending the `?facility=` query param (e.g. admin pages with their own selectors). */
  skipFacilityParam?: boolean;
  /** Match the active state on the exact path only, not the `href/` prefix. */
  exact?: boolean;
}

interface NavSection {
  title?: string;
  accent?: string;
  items: NavItem[];
}

const SECTION_ACCENTS = {
  production: "var(--clr-orange)",
  infrastructure: "var(--clr-purple)",
  distribution: "var(--clr-rose)",
  verification: "var(--clr-pink)",
  // Certification is its own first-class section (ADR 0007); it gets a distinct
  // accent key rather than reusing `verification`, even though both read pink.
  certification: "var(--clr-pink)",
  admin: "var(--clr-red)",
  default: "var(--clr-rose)",
} as const;

// Certification is a conditional workspace (ADR 0007): its operational routes
// only surface once the current facility is linked to a registry. Settings is
// the lone exception — it's the only place that link gets created, so it stays
// visible even when unlinked (otherwise an admin could never link a facility).
const CERTIFICATION_SECTION_TITLE = "Certification";
const CERTIFICATION_SETTINGS_HREF = "/certification/settings";

// Dark vertical gradient shared by both the desktop aside and mobile drawer
// so the two nav surfaces render identically.
const SIDEBAR_BACKGROUND_GRADIENT =
  "linear-gradient(180deg, rgba(15, 2, 26, 1) 0%, rgba(10, 1, 18, 1) 100%)";

const navSections: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: House },
      { href: "/chain-of-custody", label: "Chain of Custody", icon: TreeStructure },
    ],
    accent: SECTION_ACCENTS.default,
  },
  {
    title: "Production",
    accent: SECTION_ACCENTS.production,
    items: [
      { href: "/feedstocks", label: "Feedstocks", icon: Leaf },
      { href: "/production-runs", label: "Production Runs", icon: Factory },
      { href: "/formulations", label: "Formulations", icon: ListChecks },
      { href: "/biochar-products", label: "Biochar Products", icon: Cube },
    ],
  },
  {
    title: "Infrastructure",
    accent: SECTION_ACCENTS.infrastructure,
    items: [
      { href: "/reactors", label: "Reactors", icon: Flask },
      { href: "/storage-locations", label: "Storage Locations", icon: Package },
      { href: "/energy", label: "Energy", icon: Lightning },
    ],
  },
  {
    title: "Distribution",
    accent: SECTION_ACCENTS.distribution,
    items: [
      { href: "/suppliers", label: "Suppliers", icon: Handshake },
      { href: "/customers", label: "Customers", icon: Users },
      { href: "/orders", label: "Orders", icon: ShoppingCart },
      { href: "/deliveries", label: "Deliveries", icon: Truck },
      { href: "/applications", label: "Applications", icon: MapPin },
    ],
  },
  {
    title: "Verification",
    accent: SECTION_ACCENTS.verification,
    items: [
      { href: "/credit-batches", label: "Credit Batches", icon: Certificate },
      { href: "/samples", label: "Lab Samples", icon: TestTube },
    ],
  },
  {
    // First-class section (ADR 0007, amended 2026-06-13): surface only the
    // concrete artifact/setup routes. The root `/certification` route redirects
    // to Removals for old bookmarks and broad entry points.
    title: CERTIFICATION_SECTION_TITLE,
    accent: SECTION_ACCENTS.certification,
    items: [
      { href: "/certification/removals", label: "Removals", icon: Stack },
      { href: "/certification/ghg-statements", label: "GHG Statements", icon: FileText },
      { href: "/certification/settings", label: "Settings", icon: GearSix },
    ],
  },
];

/**
 * Admin section — appended to the nav only for users with the admin role.
 * Admin pages carry their own facility selectors, so the `?facility=` param
 * is skipped on this link.
 */
const adminSection: NavSection = {
  title: "Admin",
  accent: SECTION_ACCENTS.admin,
  items: [
    {
      href: "/admin",
      label: "Admin Panel",
      icon: GearSix,
      skipFacilityParam: true,
    },
  ],
};

function NavLink({
  item,
  isActive,
  accent,
  facilityParam,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  accent: string;
  facilityParam: string | null;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const href =
    facilityParam && !item.skipFacilityParam
      ? `${item.href}?facility=${facilityParam}`
      : item.href;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        // h-44 on touch gives a 44px tap target; md+ tightens to the original
        // 36px density. gap/px stay constant so the icon+label don't shift.
        "group relative flex items-center gap-10 h-44 md:h-36 px-12 transition-all duration-150",
        isActive
          ? "text-white"
          : "text-[var(--color-white-50)] hover:text-[var(--color-white-75)]",
      )}
    >
      {/* Active indicator — left accent bar */}
      {isActive && (
        <span
          className="absolute left-0 top-[6px] bottom-[6px] w-[2px]"
          style={{ backgroundColor: accent }}
        />
      )}

      {/* Hover background — subtle, only on inactive */}
      {!isActive && (
        <span className="absolute inset-0 bg-[var(--color-white-100)] opacity-0 group-hover:opacity-[0.04] transition-opacity duration-150" />
      )}

      {/* Active background — slightly brighter than hover */}
      {isActive && (
        <span className="absolute inset-0 bg-[var(--color-white-100)] opacity-[0.06]" />
      )}

      <Icon
        aria-hidden
        size={18}
        weight={isActive ? "fill" : "regular"}
        className="shrink-0 relative"
        style={isActive ? { color: accent } : undefined}
      />
      <span className="body-small truncate relative">{item.label}</span>
    </Link>
  );
}

function SectionLabel({ title, accent }: { title: string; accent: string }) {
  return (
    <div className="flex items-center gap-8 px-12 pb-4 pt-2">
      <span
        className="inline-block size-[5px] shrink-0 opacity-60"
        style={{ backgroundColor: accent }}
      />
      <span className="title-chapter-title text-[10px] text-[var(--color-white-25)] tracking-[0.12em]">
        {title}
      </span>
    </div>
  );
}

/**
 * Inner content of the sidebar/drawer. Owns the section list, the registry +
 * admin gating, and the active-state computation. Renders on a dark gradient
 * so both the desktop aside and the mobile drawer share one look.
 */
export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { facilityId: facilityParam } = useFacilityContext();
  const { signOut } = useAuth();
  const { data: session } = authClient.useSession();

  // Append the Admin section only for admin users. `useIsAdmin()` is
  // hydration-safe (server snapshot is `false`, so the admin subtree only
  // mounts after hydration). Server-side `requireAdmin()` in
  // src/app/admin/layout.tsx remains the actual access boundary.
  const isAdmin = useIsAdmin();

  // Gate the Certification operational routes on the current facility having a
  // registry link. The summary is DB-only (no Isometric API) and shared with
  // the certification pages, so it's usually a cache hit. Until a link is
  // confirmed, only Settings is shown — the entry point for creating one.
  const { data: certifierSummary } = useFacilityCertifierSummary(
    facilityParam ?? "",
    !!facilityParam,
  );
  const hasRegistry = Boolean(certifierSummary?.mapping);

  const baseSections = isAdmin ? [...navSections, adminSection] : navSections;
  const sections = baseSections.map((section) =>
    section.title === CERTIFICATION_SECTION_TITLE && !hasRegistry
      ? {
          ...section,
          items: section.items.filter(
            (item) => item.href === CERTIFICATION_SETTINGS_HREF,
          ),
        }
      : section,
  );

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: SIDEBAR_BACKGROUND_GRADIENT }}
    >
      {/* Brand header */}
      <div className="flex items-center h-56 px-16 border-b border-[var(--color-white-10)] shrink-0">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-10"
        >
          <div className="size-28 bg-[var(--clr-purple)] flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-[length:var(--text-xxs)] leading-none">
              D
            </span>
          </div>
          <span className="body-small font-medium text-white truncate">
            Dark Earth Carbon
          </span>
        </Link>
      </div>

      {/* Facility Selector */}
      <FacilitySelector />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-12 px-6">
        <div className="flex flex-col gap-20">
          {sections.map((section, idx) => {
            const accent = section.accent ?? SECTION_ACCENTS.default;
            return (
              <div key={section.title ?? idx} className="flex flex-col gap-1">
                {section.title && (
                  <SectionLabel title={section.title} accent={accent} />
                )}
                {section.items.map((item) => {
                  const isActive = item.exact
                    ? pathname === item.href
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                  return (
                    <NavLink
                      key={item.href + item.label}
                      item={item}
                      isActive={isActive}
                      accent={accent}
                      facilityParam={facilityParam}
                      onNavigate={onNavigate}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Footer — pinned to bottom, never scrolls */}
      <div className="shrink-0 px-6 pb-12 flex flex-col gap-4">
        {/* User row */}
        <div className="flex items-center gap-10 px-12 py-8 mt-2 bg-[var(--color-white-100)]/[0.03]">
          <div
            className="size-32 flex items-center justify-center shrink-0"
            style={{
              background: `linear-gradient(135deg, var(--clr-purple) 0%, var(--clr-pink) 100%)`,
            }}
          >
            <Users
              size={14}
              weight="bold"
              className="text-[var(--color-white-75)]"
            />
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="body-caption font-medium text-white truncate" suppressHydrationWarning>
              {session?.user?.name ?? "User"}
            </span>
            <span className="text-[10px] text-[var(--color-white-25)] truncate" suppressHydrationWarning>
              {session?.user?.email ?? " "}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              signOut();
            }}
            className="flex items-center justify-center size-44 md:size-28 text-[var(--color-white-25)] hover:text-[var(--clr-rose)] transition-colors duration-150"
            aria-label="Sign out"
          >
            <SignOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
