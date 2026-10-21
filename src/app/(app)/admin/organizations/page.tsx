/**
 * Platform: Organizations. Platform Admins list every organization, open any
 * one (sets the session's active org), and create the first org. Access is
 * gated by the parent admin layout's requireAdmin() guard.
 *
 * The only surface that genuinely lives under `/admin`: everything else it used
 * to advertise was organization configuration, which moved to `/settings` where
 * an org Admin can actually reach it.
 */
import { PageHeader } from "@/components/ui";
import { OrganizationsAdmin } from "@/components/organizations/organizations-admin";

export default function AdminOrganizationsPage() {
  return (
    <div className="container-max page-shell">
      <PageHeader eyebrow="Platform" title="Organizations" />

      <OrganizationsAdmin />
    </div>
  );
}
