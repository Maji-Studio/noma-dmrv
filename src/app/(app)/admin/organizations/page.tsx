/**
 * Admin — Organizations. Platform Admins list every organization, enter any
 * one (sets the session's active org), and create the first org. Access is
 * gated by the parent admin layout's requireAdmin() guard.
 */
import { OrganizationsAdmin } from "@/components/organizations/organizations-admin";

export default function AdminOrganizationsPage() {
  return (
    <div className="container-max page-shell">
      <header className="flex flex-col gap-8">
        <span className="title-chapter-title text-[var(--color-text-tertiary)]">
          Admin
        </span>
        <h1 className="title-heading-2">Organizations</h1>
        <p className="body-medium text-[var(--color-text-secondary)] max-w-[680px]">
          Every operator on the platform. Enter an organization to work inside
          its workspace, or create the first one.
        </p>
      </header>

      <OrganizationsAdmin />
    </div>
  );
}
