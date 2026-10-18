/**
 * Settings → Connected apps. Every member sees their own connections;
 * Owners and Admins also see every member's and can disconnect any.
 */
import { redirect } from "next/navigation";
import { ConnectedApps } from "@/components/oauth/connected-apps";
import { SettingsConsole } from "@/components/settings";
import { canOwnApiKey } from "@/lib/auth/api-scopes";
import { oauthRolePolicy } from "@/lib/auth/oauth-role-policy";
import { getOrgContext } from "@/lib/auth/server";
import { readActiveOrganization } from "@/lib/read-models";

export default async function ConnectedAppsPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/dashboard");
  const org = await readActiveOrganization(ctx);
  const policy = oauthRolePolicy(ctx.orgRole ?? "");
  const canManage = canOwnApiKey(ctx.orgRole);

  return (
    <SettingsConsole
      title="Connected apps"
      caption="Apps you have allowed to act for you in this organization."
      access="You and organization Owners and Admins"
      subtitle="See which apps are connected and disconnect any you no longer use."
      canManageDefaults={ctx.isPlatformAdmin || canManage}
      canManageApiKeys={canManage}
      isPlatformAdmin={ctx.isPlatformAdmin}
    >
      <ConnectedApps
        organizationId={ctx.organizationId}
        organizationName={org?.name ?? "this organization"}
        userId={ctx.userId}
        canManageAll={policy.manageAll}
        isMember={policy.manageOwn}
      />
    </SettingsConsole>
  );
}
