/**
 * Settings, Developers: whether API access is on for the organization (a
 * Platform Admin switch, read-only here, Q7) and the organization's API keys.
 * Keys need a live Owner/Admin membership; a Platform Admin without one sees
 * the pane without the controls.
 */
import { ApiKeySettings } from "@/components/api-keys";
import { ApiAccessLine, SettingsConsole } from "@/components/settings";
import { readOrganizationApiAccess } from "@/lib/read-models";
import { assertSettingsPaneVisible, loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function DevelopersSettingsPage() {
  const { ctx, viewer } = await loadSettingsViewer();
  assertSettingsPaneVisible(viewer, "developers");
  const apiAccessEnabled = await readOrganizationApiAccess(ctx);

  return (
    <SettingsConsole pane="developers" viewer={viewer}>
      <ApiAccessLine enabled={apiAccessEnabled} />
      <ApiKeySettings canManage={viewer.canManageApiKeys} organizationId={viewer.organizationId} />
    </SettingsConsole>
  );
}
