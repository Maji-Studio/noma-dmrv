/**
 * Main app layout
 * Provides sidebar navigation and authenticated layout wrapper
 */
import { requireAuth } from "@/lib/auth/server";
import { AppSidebar, MobileNav } from "@/components/navigation";
import { FacilityProvider } from "@/components/navigation/facility-provider";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Require authentication - redirects to /login if not authenticated
  await requireAuth();

  return (
    <FacilityProvider>
      {/* Desktop: sidebar + main side by side. Mobile: a sticky top bar
          stacks above a full-width main (the sidebar is hidden, its nav lives
          in the drawer that MobileNav opens). */}
      <div className="min-h-screen flex flex-col md:flex-row">
        <AppSidebar />
        <MobileNav />
        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </FacilityProvider>
  );
}
