/**
 * Settings, Members. Any member can view the roster; Owners/Admins (and
 * Platform Admins) get the invite, role-change, remove, and revoke controls.
 */
import { OrganizationSettings } from "@/components/organizations/organization-settings";
import { SettingsConsole } from "@/components/settings";
import { loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function MembersSettingsPage() {
  const { viewer } = await loadSettingsViewer();
  return (
    <SettingsConsole pane="members" viewer={viewer}>
      <OrganizationSettings canManage={viewer.canManage} />
    </SettingsConsole>
  );
}
