/**
 * Settings → Vehicles and crew. Every member can list, edit and delete the
 * organization's vehicles, drivers and operators, as they can create them from
 * the pickers on intake, delivery and production forms.
 */
import { redirect } from "next/navigation";
import { FleetSettings, SettingsConsole } from "@/components/settings";
import { canOwnApiKey } from "@/lib/auth/api-scopes";
import { getOrgContext } from "@/lib/auth/server";

export default async function VehiclesAndCrewSettingsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/dashboard");

  const canManageDefaults =
    ctx.isPlatformAdmin || ctx.orgRole === "owner" || ctx.orgRole === "admin";

  return (
    <SettingsConsole
      title="Vehicles and crew"
      caption="The vehicles, drivers and operators your records name. Vehicle type and model year are kept as transport evidence."
      access="All members"
      subtitle="Manage the vehicles, drivers and operators your organization records."
      canManageDefaults={canManageDefaults}
      canManageApiKeys={canOwnApiKey(ctx.orgRole)}
      isPlatformAdmin={ctx.isPlatformAdmin}
    >
      <FleetSettings />
    </SettingsConsole>
  );
}
