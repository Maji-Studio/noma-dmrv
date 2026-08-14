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

import { useState } from "react";
import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HouseIcon,
  TreeStructureIcon,
  LeafIcon,
  FactoryIcon,
  HandshakeIcon,
  UsersIcon,
  TruckIcon,
  CubeIcon,
  FlaskIcon,
  PackageIcon,
  ShoppingCartIcon,
  MapPinIcon,
  CertificateIcon,
  StackIcon,
  FileTextIcon,
  TestTubeIcon,
  TagIcon,
  ListChecksIcon,
  LightningIcon,
  GearSixIcon,
  BuildingsIcon,
  SignOutIcon,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import {
  AUTH_SIGNED_OUT_STORAGE_KEY,
  authClient,
  useAuth,
} from "@/lib/auth/client";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { useToast } from "@/components/ui/toast";
import { FacilitySelector } from "./facility-selector";
import { OrgBrand } from "./org-brand";
import { useFacilityContext } from "@/hooks/use-facility-context";

interface NavItem {
  href: string;
  label: string;
  icon: Icon;
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
      { href: "/dashboard", label: "Dashboard", icon: HouseIcon },
      { href: "/traceability", label: "Traceability", icon: TreeStructureIcon },
    ],
    accent: SECTION_ACCENTS.default,
  },
  {
    title: "Production",
    accent: SECTION_ACCENTS.production,
    items: [
      { href: "/feedstocks", label: "Feedstocks", icon: LeafIcon },
      { href: "/production-runs", label: "Production Runs", icon: FactoryIcon },
      { href: "/formulations", label: "Formulations", icon: ListChecksIcon },
      { href: "/biochar-products", label: "Biochar Products", icon: CubeIcon },
    ],
  },
  {
    title: "Infrastructure",
    accent: SECTION_ACCENTS.infrastructure,
    items: [
      { href: "/reactors", label: "Reactors", icon: FlaskIcon },
      { href: "/storage-locations", label: "Storage Bins", icon: PackageIcon },
      { href: "/feedstock-types", label: "Feedstock Types", icon: TagIcon },
      { href: "/energy", label: "Energy", icon: LightningIcon },
    ],
  },
  {
    title: "Distribution",
    accent: SECTION_ACCENTS.distribution,
    items: [
      { href: "/suppliers", label: "Suppliers", icon: HandshakeIcon },
      { href: "/customers", label: "Customers", icon: UsersIcon },
      { href: "/orders", label: "Orders", icon: ShoppingCartIcon },
      { href: "/deliveries", label: "Deliveries", icon: TruckIcon },
      { href: "/applications", label: "Applications", icon: MapPinIcon },
    ],
  },
  {
    title: "Verification",
    accent: SECTION_ACCENTS.verification,
    items: [
      { href: "/credit-batches", label: "Credit Batches", icon: CertificateIcon },
      { href: "/samples", label: "Lab Samples", icon: TestTubeIcon },
    ],
  },
  {
    // First-class section (ADR 0007, amended 2026-06-13): surface only the
    // concrete artifact/setup routes. The root `/certification` route redirects
    // to Removals for old bookmarks and broad entry points.
    //
    title: CERTIFICATION_SECTION_TITLE,
    accent: SECTION_ACCENTS.certification,
    items: [
      { href: "/certification/removals", label: "Removals", icon: StackIcon },
      { href: "/certification/ghg-statements", label: "GHG Statements", icon: FileTextIcon },
      { href: "/certification/settings", label: "Settings", icon: GearSixIcon },
    ],
  },
];

/**
 * Admin section — appended to the nav only for users with the admin role.
 *
 * One item, because the organization directory is the only surface that lives
 * under `/admin`. It used to point at an `/admin` hub whose other two tiles
 * were cross-links to pages already in this sidebar; the label now names the
 * destination instead of the gate. Cross-tenant by definition, so the
 * `?facility=` param is skipped.
 */
const adminSection: NavSection = {
  title: "Admin",
  accent: SECTION_ACCENTS.admin,
  items: [
    {
      href: "/admin/organizations",
      label: "Organizations",
      icon: BuildingsIcon,
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
        // Mobile drawer breathes: 48px rows + roomier icon gap; md+ tightens to
        // the original 36px density / 10px gap so the desktop rail is unchanged.
        "group relative flex items-center gap-12 md:gap-10 h-48 md:h-36 px-12 transition-all duration-150",
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
    <div className="flex items-center gap-8 px-12 pb-6 pt-4 md:pb-4 md:pt-2">
      <span
        className="inline-block size-[5px] shrink-0 opacity-60"
        style={{ backgroundColor: accent }}
      />
      {/* white-50 composites to ~4.7:1 on the near-black gradient — the 10px
          uppercase label needs the full 4.5:1 floor; white-25 measured ~2:1. */}
      <span className="title-chapter-title text-[10px] text-[var(--color-white-50)] tracking-[0.12em]">
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
  const toast = useToast();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (isSigningOut) return;

    setIsSigningOut(true);

    // The provider catches request failures and resolves { success: false }
    // rather than throwing. Only a confirmed sign-out may broadcast the cross-tab
    // signal or navigate: on failure the session is still live, so broadcasting
    // would falsely log other tabs out and navigating to /login would be bounced
    // straight back to a protected page by middleware.
    const result = await signOut();
    if (!result.success) {
      toast.error(result.error ?? "You could not be signed out. Try again.");
      setIsSigningOut(false);
      return;
    }

    onNavigate?.();

    try {
      localStorage.setItem(
        AUTH_SIGNED_OUT_STORAGE_KEY,
        String(Date.now()),
      );
    } catch {
      // Full navigation still clears this tab when storage is unavailable.
    }
    // replace(), not assign(): keep the authenticated page out of history/bfcache
    // so Back cannot restore it (matches the listener tabs' navigation).
    window.location.replace("/login");
  }

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
      {/* Brand header — doubles as the org switcher for multi-org users */}
      <OrgBrand onNavigate={onNavigate} />

      {/* Facility Selector */}
      <FacilitySelector />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-16 px-8 md:py-12 md:px-6">
        <div className="flex flex-col gap-24 md:gap-20">
          {sections.map((section, idx) => {
            const accent = section.accent ?? SECTION_ACCENTS.default;
            return (
              <div key={section.title ?? idx} className="flex flex-col gap-4 md:gap-1">
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
            <UsersIcon
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
          {/* Straight to Members rather than `/settings`, which only
              redirects here — the settings rail is the index.

              The name stays "Organization settings": the Certification section
              already carries a link named exactly "Settings", and two links in
              the same nav with one accessible name is ambiguous for screen
              reader users and for any by-name lookup. */}
          <Link
            href="/settings/organization"
            onClick={onNavigate}
            className="flex items-center justify-center size-44 md:size-28 text-[var(--color-white-25)] hover:text-white transition-colors duration-150"
            aria-label="Organization settings"
          >
            <GearSixIcon size={16} />
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="flex items-center justify-center size-44 md:size-28 text-[var(--color-white-25)] hover:text-[var(--clr-rose)] transition-colors duration-150 disabled:cursor-wait disabled:opacity-40"
            aria-label="Sign out"
          >
            <SignOutIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
