/**
 * Main app layout
 * Provides navigation and authenticated layout wrapper
 */
import { requireAuth } from "@/lib/auth/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Require authentication - redirects to /login if not authenticated
  await requireAuth();

  return (
    <div className="min-h-screen">
      {/* TODO: Add navigation component */}
      <main>{children}</main>
    </div>
  );
}
