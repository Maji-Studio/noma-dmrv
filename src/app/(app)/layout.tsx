/**
 * Main app layout
 * Provides sidebar navigation and authenticated layout wrapper
 */
import { requireAuth } from "@/lib/auth/server";
import { AppSidebar } from "@/components/navigation";
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
      <div className="min-h-screen flex">
        <AppSidebar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </FacilityProvider>
  );
}
