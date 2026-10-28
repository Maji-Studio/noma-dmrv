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
import { PLATFORM_HOME_HREF } from "@/lib/auth/home-path";
import { PLATFORM_DIAGNOSTICS_HREF, PLATFORM_TEMPLATE_MAPPING_HREF } from "@/lib/settings/links";
import { usePathname } from "next/navigation";
import {
  HouseIcon,
  TreeStructureIcon,
  PulseIcon,
  FlowArrowIcon,
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
  CloudIcon,
  GearSixIcon,
  BuildingsIcon,
  SignOutIcon,
  VanIcon,
  UsersThreeIcon,
  WarehouseIcon,
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
import {
  SETTINGS_GENERAL_HREF,
  CREW_HREF,
  VEHICLES_HREF,
  withFacilityParam,
} from "@/lib/settings/links";

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
  records: "var(--clr-orange)",
  verification: "var(--clr-pink)",
  partners: "var(--clr-rose)",
  // Certification is its own first-class section (ADR 0007); it gets a distinct
  // accent key rather than reusing `verification`, even though both read pink.
  certification: "var(--clr-pink)",
  setup: "var(--clr-purple)",
  admin: "var(--clr-red)",
  default: "var(--clr-rose)",
} as const;

// Certification is a conditional workspace (ADR 0007): its routes only surface
// once the current facility is linked to a registry. Without a link the section
// shows nothing; the link is made in Settings, Certification, and the registry
// guard sends a direct visit there (#1277).
const CERTIFICATION_SECTION_TITLE = "Certification";

// Screenshot mode: see next.config.ts and docs/testing.md#pr-screenshots.
const SHOT_MODE = process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_SHOT_MODE === "true";

// Dark vertical gradient shared by both the desktop aside and mobile drawer
// so the two nav surfaces render identically.
const SIDEBAR_BACKGROUND_GRADIENT =
  "linear-gradient(180deg, rgba(15, 2, 26, 1) 0%, rgba(10, 1, 18, 1) 100%)";

// Groups follow how often a page is used (2026-10-28): Records are the daily
// entries, Verification the checks on them, Partners the parties they name,
// Certification the registry artifacts, Setup the things configured once.
const navSections: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: HouseIcon },
      { href: "/traceability", label: "Traceability", icon: TreeStructureIcon },
    ],
    accent: SECTION_ACCENTS.default,
  },
  {
    title: "Records",
    accent: SECTION_ACCENTS.records,
    items: [
      { href: "/feedstock-intake", label: "Feedstock intake", icon: LeafIcon },
      { href: "/production-runs", label: "Production runs", icon: FactoryIcon },
      { href: "/biochar-products", label: "Biochar products", icon: CubeIcon },
      { href: "/orders", label: "Orders", icon: ShoppingCartIcon },
      { href: "/deliveries", label: "Deliveries", icon: TruckIcon },
      { href: "/applications", label: "Applications", icon: MapPinIcon },
    ],
  },
  {
    title: "Verification",
    accent: SECTION_ACCENTS.verification,
    items: [
      { href: "/credit-batches", label: "Credit batches", icon: CertificateIcon },
      { href: "/lab-samples", label: "Lab Samples", icon: TestTubeIcon },
      { href: "/emissions", label: "Emissions", icon: CloudIcon },
    ],
  },
  {
    title: "Partners",
    accent: SECTION_ACCENTS.partners,
    items: [
      { href: "/suppliers", label: "Suppliers", icon: HandshakeIcon },
      { href: "/customers", label: "Customers", icon: UsersIcon },
    ],
  },
  {
    // First-class section (ADR 0007, amended 2026-06-13): surface only the
    // concrete artifact routes, /removals and /ghg-statements.
    title: CERTIFICATION_SECTION_TITLE,
    accent: SECTION_ACCENTS.certification,
    items: [
      { href: "/removals", label: "Removals", icon: StackIcon },
      { href: "/ghg-statements", label: "GHG Statements", icon: FileTextIcon },
    ],
  },
  {
    title: "Setup",
    accent: SECTION_ACCENTS.setup,
    items: [
      { href: "/storage-bins", label: "Storage bins", icon: PackageIcon },
      { href: "/feedstock-types", label: "Feedstock types", icon: TagIcon },
      { href: "/reactors", label: "Reactors", icon: FlaskIcon },
      { href: "/formulations", label: "Formulations", icon: ListChecksIcon },
      { href: VEHICLES_HREF, label: "Vehicles", icon: VanIcon },
      { href: CREW_HREF, label: "Crew", icon: UsersThreeIcon },
      // Organization-wide: the page lists every facility, so no `?facility=`.
      { href: "/facilities", label: "Facilities", icon: WarehouseIcon, skipFacilityParam: true },
    ],
  },
];

/**
 * Platform section — appended to the nav only for Platform Admins.
 *
 * Organizations (the Platform home), Diagnostics and Template mapping, which
 * moved here from Settings (#1373). Organizations and Diagnostics are not
 * about one facility, so they skip the `?facility=` param; Template mapping
 * shows the working facility, so it keeps it.
 */
const adminSection: NavSection = {
  title: "Platform",
  accent: SECTION_ACCENTS.admin,
  items: [
    {
      href: PLATFORM_HOME_HREF,
      label: "Organizations",
      icon: BuildingsIcon,
      skipFacilityParam: true,
    },
    {
      href: PLATFORM_DIAGNOSTICS_HREF,
      label: "Diagnostics",
      icon: PulseIcon,
      skipFacilityParam: true,
    },
    { href: PLATFORM_TEMPLATE_MAPPING_HREF, label: "Template mapping", icon: FlowArrowIcon },
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
      <span className="title-chapter-title text-[var(--color-white-50)] tracking-[0.12em]">
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

  // Append the Platform section only for Platform Admins. `useIsAdmin()` is
  // hydration-safe (server snapshot is `false`, so the admin subtree only
  // mounts after hydration). Server-side `requireAdmin()` in
  // src/app/(app)/platform/layout.tsx remains the actual access boundary.
  const isAdmin = useIsAdmin();

  // Gate the Certification routes on the current facility having a registry
  // link. The summary is DB-only (no Isometric API) and shared with the
  // certification pages, so it's usually a cache hit. Until a link is
  // confirmed the section is left out.
  const { data: certifierSummary } = useFacilityCertifierSummary(
    facilityParam ?? "",
    !!facilityParam,
  );
  const hasRegistry = Boolean(certifierSummary?.mapping);

  const baseSections = isAdmin ? [...navSections, adminSection] : navSections;
  const sections = baseSections.filter(
    (section) => section.title !== CERTIFICATION_SECTION_TITLE || hasRegistry,
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
            {/* Screenshot mode (docs/testing.md#pr-screenshots) hides the
                account text so PR evidence never shows a real email. */}
            {!SHOT_MODE && (
              <>
                <span className="body-caption font-medium text-white truncate" suppressHydrationWarning>
                  {session?.user?.name ?? "User"}
                </span>
                <span className="text-[10px] text-[var(--color-white-25)] truncate" suppressHydrationWarning>
                  {session?.user?.email ?? " "}
                </span>
              </>
            )}
          </div>
          {/* Straight to General rather than `/settings`, which only
              redirects there: the settings rail is the index, and General is
              the pane every member can open (Q15). The only link in the nav
              named "Settings" since Certification lost its own. */}
          <Link
            href={withFacilityParam(SETTINGS_GENERAL_HREF, facilityParam)}
            onClick={onNavigate}
            className="flex items-center justify-center size-44 md:size-28 text-[var(--color-white-25)] hover:text-white transition-colors duration-150"
            aria-label="Settings"
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
