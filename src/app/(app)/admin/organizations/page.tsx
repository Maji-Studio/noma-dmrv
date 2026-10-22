/**
 * Platform: Organizations, the Platform home (#1365). Platform Admins pick an
 * organization to switch into it, set its Isometric keys and API access, and
 * create organizations (#1373). Access is gated by the parent admin layout's
 * requireAdmin() guard.
 */
import { PageHeader } from "@/components/ui";
import { PlatformOrganizations } from "@/components/organizations/platform-organizations";

export default function AdminOrganizationsPage() {
  return (
    <div className="container-max page-shell">
      <PageHeader eyebrow="Platform" title="Organizations" />
      <PlatformOrganizations />
    </div>
  );
}
