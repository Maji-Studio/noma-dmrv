import { redirect } from "next/navigation";
import { ApiKeySettings } from "@/components/api-keys";
import { SettingsConsole } from "@/components/settings";
import { canOwnApiKey } from "@/lib/auth/api-scopes";
import { getOrgContext } from "@/lib/auth/server";

export default async function ApiKeysPage() {
  const ctx = await getOrgContext();
  if (!ctx) redirect("/dashboard");
  const canManage = canOwnApiKey(ctx.orgRole);

  return (
    <SettingsConsole
      title="API keys"
      caption="A key acts as its owner, limited to the permissions you select."
      access="Organization Owners and Admins"
      subtitle="Manage API access for your organization."
      canManageDefaults={ctx.isPlatformAdmin || canManage}
      canManageApiKeys={canManage}
      isPlatformAdmin={ctx.isPlatformAdmin}
    >
      <ApiKeySettings canManage={canManage} organizationId={ctx.organizationId} />
    </SettingsConsole>
  );
}
