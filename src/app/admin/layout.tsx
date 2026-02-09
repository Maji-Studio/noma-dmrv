/**
 * Admin layout
 * Provides admin-specific navigation and access control
 */
import { requireAdmin } from "@/lib/auth/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Require admin authentication - redirects to /unauthorized if not admin
  await requireAdmin();

  return (
    <div className="min-h-screen">
      {/* TODO: Add admin navigation */}
      <main>{children}</main>
    </div>
  );
}
