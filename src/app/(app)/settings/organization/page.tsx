/**
 * Settings → Members. Any member can view the roster; Owners/Admins (and
 * Platform Admins) get the invite, role-change, remove, and revoke controls.
 */
import { redirect } from "next/navigation";
import { OrganizationSettings } from "@/components/organizations/organization-settings";
import { SettingsConsole } from "@/components/settings";
import { getActiveOrganizationProfile } from "@/fn/organizations";
import { getOrgContext } from "@/lib/auth/server";

export default async function OrganizationSettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) {
    // No active organization selected — send to the dashboard, where the org
    // switcher / chooser resolves one.
    redirect("/dashboard");
  }

  const org = await getActiveOrganizationProfile();
  const canManage =
    ctx.isPlatformAdmin || ctx.orgRole === "owner" || ctx.orgRole === "admin";

  return (
    <SettingsConsole
      title="Members"
      caption="Who can sign in to this organization, and what each of them may change."
      access="Owners and Admins"
      subtitle={
        org
          ? `Manage members and access for ${org.name}.`
          : "Manage members and access for your organization."
      }
      canManageDefaults={canManage}
      isPlatformAdmin={ctx.isPlatformAdmin}
    >
      <OrganizationSettings canManage={canManage} />
    </SettingsConsole>
  );
}
