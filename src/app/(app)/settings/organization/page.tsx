/**
 * Organization settings — member management for the active organization.
 * Any member can view the roster; Owners/Admins (and Platform Admins) get the
 * invite, role-change, remove, and revoke controls.
 */
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getOrgContext } from "@/lib/auth/server";
import { getActiveOrganizationProfile } from "@/fn/organizations";
import { OrganizationSettings } from "@/components/organizations/organization-settings";

export default async function OrganizationSettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) {
    // No active organization selected — send to the dashboard, where the org
    // switcher / chooser resolves one.
    redirect("/dashboard");
  }

  const org = await getActiveOrganizationProfile();
  const canManage =
    ctx.isPlatformAdmin ||
    ctx.orgRole === "owner" ||
    ctx.orgRole === "admin";

  return (
    <div className="container-max page-shell">
      <PageHeader
        eyebrow="Settings"
        title="Organization"
        subtitle={
          org
            ? `Manage members and access for ${org.name}.`
            : "Manage members and access for your organization."
        }
      />
      <OrganizationSettings canManage={canManage} />
    </div>
  );
}
