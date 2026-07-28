/**
 * Main app layout
 * Provides sidebar navigation and authenticated layout wrapper
 */
import { getOrgContext, requireAuth } from "@/lib/auth/server";
import { getOrganizationDefaults } from "@/data-access/organization-settings";
import { AppSidebar, MobileNav } from "@/components/navigation";
import { FacilityProvider } from "@/components/navigation/facility-provider";
import { SessionSignOutListener } from "@/components/auth/session-signout-listener";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Require authentication - redirects to /login if not authenticated
  await requireAuth();

  // Seed the active org resolved server-side so the facilities query enables on
  // first client render — otherwise a deep-linked `?facility=` resolves to
  // nothing until `authClient.useSession()` delivers the org, flashing the
  // "Select a facility" gate (#473). `null` when the user has no active org yet.
  const orgContext = await getOrgContext();

  // Operating defaults resolved here, on the server, for the same reason as the
  // org above: create forms read them for react-hook-form `defaultValues`,
  // which is captured once at mount. Fetching them from the client left a
  // window — a hard load onto `/deliveries?create=true` mounts the form in the
  // same tick the fetch starts — in which a record would be created with the
  // system fallback instead of the organization's currency or trip type.
  const organizationDefaults = orgContext
    ? {
        defaults: await getOrganizationDefaults(orgContext),
        viewerCanManage:
          orgContext.isPlatformAdmin ||
          orgContext.orgRole === "owner" ||
          orgContext.orgRole === "admin",
      }
    : undefined;

  return (
    <FacilityProvider
      initialOrganizationId={orgContext?.organizationId ?? null}
      initialOrganizationDefaults={organizationDefaults}
    >
      <SessionSignOutListener />
      {/* Desktop: sidebar + main side by side. Mobile: a sticky top bar
          stacks above a full-width main (the sidebar is hidden, its nav lives
          in the drawer that MobileNav opens).

          `main` carries `overflow-auto`, which makes it the scrollport for any
          `position: sticky` descendant. Without a bounded height it grows with
          its content and never scrolls internally — the window scrolls — so a
          sticky child has a scrollport that never moves and silently fails to
          stick. `md:h-screen` gives the desktop shell the fixed-frame height
          the sidebar already assumes (`h-screen sticky top-0`), so `main` is a
          real scroll container and in-page sticky rails work. Below `md` the
          window keeps scrolling as before. */}
      <div className="min-h-screen flex flex-col md:h-screen md:flex-row md:overflow-hidden">
        <AppSidebar />
        <MobileNav />
        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </FacilityProvider>
  );
}
