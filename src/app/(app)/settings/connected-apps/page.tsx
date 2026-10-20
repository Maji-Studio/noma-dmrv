/**
 * Settings, Connected apps. Every member sees their own connections;
 * Owners and Admins also see every member's and can disconnect any.
 */
import { ConnectedApps } from "@/components/oauth";
import { SettingsConsole } from "@/components/settings";
import { oauthRolePolicy } from "@/lib/auth/oauth-role-policy";
import { loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function ConnectedAppsPage() {
  const { ctx, viewer } = await loadSettingsViewer();
  const policy = oauthRolePolicy(ctx.orgRole ?? "");

  return (
    <SettingsConsole pane="connected-apps" viewer={viewer}>
      <ConnectedApps
        organizationId={viewer.organizationId}
        organizationName={viewer.organizationName}
        userId={ctx.userId}
        canManageAll={policy.manageAll}
        isMember={policy.manageOwn}
      />
    </SettingsConsole>
  );
}
