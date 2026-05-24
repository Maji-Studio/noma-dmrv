/**
 * App Sidebar Component
 *
 * 240px dark sidebar with brand identity. Grouped nav with section labels,
 * accent-colored active indicators, and pinned footer.
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
  ClipboardText,
  SealCheck,
  TestTube,
  ListChecks,
  Lightning,
  GearSix,
  SignOut,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { useAuth, authClient } from "@/lib/auth/client";
import { FacilitySelector } from "./facility-selector";
import { useFacilityContext } from "@/hooks/use-facility-context";

interface NavItem {
  href: string;
  label: string;
  icon: ElementType;
  /** Skip appending the `?facility=` query param (e.g. admin pages with their own selectors). */
  skipFacilityParam?: boolean;
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
  admin: "var(--clr-red)",
  default: "var(--clr-rose)",
} as const;

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
      { href: "/energy", label: "Energy", icon: Lightning },
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
    title: "Certification",
    accent: SECTION_ACCENTS.verification,
    items: [
      { href: "/certification/removals", label: "Removals", icon: SealCheck },
      {
        href: "/certification/ghg-statements",
        label: "GHG Statements",
        icon: ClipboardText,
      },
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
}: {
  item: NavItem;
  isActive: boolean;
  accent: string;
  facilityParam: string | null;
}) {
  const Icon = item.icon;
  const href =
    facilityParam && !item.skipFacilityParam
      ? `${item.href}?facility=${facilityParam}`
      : item.href;
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex items-center gap-10 h-36 px-12 transition-all duration-150",
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

export function AppSidebar() {
  const pathname = usePathname();
  const { facilityId: facilityParam } = useFacilityContext();
  const { signOut } = useAuth();
  const { data: session } = authClient.useSession();

  // Append the Admin section only for admin users. Server-side `requireAdmin()`
  // in src/app/admin/layout.tsx remains the actual access boundary.
  // `role` is a Better Auth additionalField absent from the inferred client
  // user type — assert it as the auth provider layer does.
  const userRole = (session?.user as { role?: string } | undefined)?.role;
  const sections =
    userRole === "admin" ? [...navSections, adminSection] : navSections;

  return (
    <aside
      className="w-[240px] shrink-0 h-screen sticky top-0 flex flex-col"
      style={{
        background: `linear-gradient(
          180deg,
          rgba(15, 2, 26, 1) 0%,
          rgba(10, 1, 18, 1) 100%
        )`,
      }}
    >
      {/* Brand header */}
      <div className="flex items-center h-56 px-16 border-b border-[var(--color-white-10)]">
        <Link href="/dashboard" className="flex items-center gap-10">
          <div className="size-28 bg-[var(--clr-purple)] flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-[12px] leading-none">
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
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
                  return (
                    <NavLink
                      key={item.href + item.label}
                      item={item}
                      isActive={isActive}
                      accent={accent}
                      facilityParam={facilityParam}
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
              {session?.user?.email ?? " "}
            </span>
          </div>
          <button
            type="button"
            onClick={() => signOut()}
            className="flex items-center justify-center size-28 text-[var(--color-white-25)] hover:text-[var(--clr-rose)] transition-colors duration-150"
            aria-label="Sign out"
          >
            <SignOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
