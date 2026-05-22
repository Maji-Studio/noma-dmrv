/**
 * Admin layout
 * Thin authorization boundary for the /admin route subtree. The app shell
 * (sidebar, FacilityProvider) is inherited from the parent (app) layout —
 * admin pages render inside the same chrome as the rest of the app.
 */
import { requireAdmin } from "@/lib/auth/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Redirects to /unauthorized if the signed-in user is not an admin.
  await requireAdmin();

  return <>{children}</>;
}
