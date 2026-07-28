/**
 * Admin — Organizations. Platform Admins list every organization, enter any
 * one (sets the session's active org), and create the first org. Access is
 * gated by the parent admin layout's requireAdmin() guard.
 *
 * The only surface that genuinely lives under `/admin`: everything else it used
 * to advertise was organization configuration, which moved to `/settings` where
 * an org Owner/Admin can actually reach it.
 */
import { PageHeader } from "@/components/ui";
import { OrganizationsAdmin } from "@/components/organizations/organizations-admin";

export default function AdminOrganizationsPage() {
  return (
    <div className="container-max page-shell">
      <PageHeader
        eyebrow="Admin"
        title="Organizations"
        subtitle="Every operator on the platform. Enter an organization to work inside its workspace, or create the first one."
      />

      <OrganizationsAdmin />
    </div>
  );
}
