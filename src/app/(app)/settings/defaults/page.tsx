/**
 * Settings → Defaults. The organization's operating defaults: the currency,
 * country, timezone, trip type, evidence method and packaging that seed new
 * records instead of being retyped on each one.
 *
 * Owner/Admin only, and gated here as well as in the action — a member landing
 * on a form they cannot submit is worse than not seeing the route.
 */
import { notFound, redirect } from "next/navigation";
import { SettingsConsole, OrganizationDefaultsForm } from "@/components/settings";
import { getActiveOrganizationProfile } from "@/fn/organizations";
import { getOrgContext } from "@/lib/auth/server";

export default async function OrganizationDefaultsPage() {
  const ctx = await getOrgContext();
  if (!ctx) {
    redirect("/dashboard");
  }

  const canManage =
    ctx.isPlatformAdmin || ctx.orgRole === "owner" || ctx.orgRole === "admin";
  if (!canManage) notFound();

  const org = await getActiveOrganizationProfile();

  return (
    <SettingsConsole
      title="Defaults"
      caption="What new records start with. Every one stays editable on the record itself."
      access="Owners and Admins"
      subtitle={
        org
          ? `Set how new records start out for ${org.name}.`
          : "Set how new records start out for your organization."
      }
      canManageDefaults={canManage}
      isPlatformAdmin={ctx.isPlatformAdmin}
    >
      <OrganizationDefaultsForm />
    </SettingsConsole>
  );
}
