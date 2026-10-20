/**
 * Settings, Developers: whether API access is on for the organization (a
 * Platform Admin switch, read-only here, Q7) and the organization's API keys.
 * Keys need a live Owner/Admin membership. The rail lists the pane only for
 * Owners, Admins and Platform Admins; anyone else who opens the URL reads why
 * there are no controls, as on the former API keys route.
 */
import { ApiKeySettings } from "@/components/api-keys";
import { ApiAccessLine, SettingsConsole } from "@/components/settings";
import { readOrganizationApiAccess } from "@/lib/read-models/organization-registry-status";
import { loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function DevelopersSettingsPage() {
  const { ctx, viewer } = await loadSettingsViewer();
  const apiAccessEnabled = await readOrganizationApiAccess(ctx);

  return (
    <SettingsConsole pane="developers" viewer={viewer}>
      <ApiAccessLine enabled={apiAccessEnabled} />
      <ApiKeySettings canManage={viewer.canManageApiKeys} organizationId={viewer.organizationId} />
    </SettingsConsole>
  );
}
