/**
 * Settings → Defaults. The organization's operating defaults: the country,
 * timezone, evidence method and packaging that seed new
 * records instead of being retyped on each one.
 *
 * Admin only, and gated here as well as in the action — a member landing
 * on a form they cannot submit is worse than not seeing the route.
 */
import { notFound, redirect } from "next/navigation";
import { SettingsConsole, OrganizationDefaultsForm } from "@/components/settings";
import { canOwnApiKey } from "@/lib/auth/api-scopes";
import { getOrgContext } from "@/lib/auth/server";

export default async function OrganizationDefaultsPage() {
  const ctx = await getOrgContext();
  if (!ctx) {
    redirect("/dashboard");
  }

  const canManage =
    ctx.isPlatformAdmin || ctx.orgRole === "admin";
  if (!canManage) notFound();

  return (
    <SettingsConsole
      title="Defaults"
      caption="What new records start with. Every one stays editable on the record itself."
      access="Admins"
      canManageDefaults={canManage}
      canManageApiKeys={canOwnApiKey(ctx.orgRole)}
      isPlatformAdmin={ctx.isPlatformAdmin}
    >
      <OrganizationDefaultsForm />
    </SettingsConsole>
  );
}
