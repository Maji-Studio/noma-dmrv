/**
 * Settings, General: the organization and its operating defaults. Every
 * member can open it; only Owners and Admins change the defaults, which the
 * defaults action enforces as well.
 */
import { GeneralSettingsPane, SettingsConsole } from "@/components/settings";
import { loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function GeneralSettingsPage() {
  const { viewer } = await loadSettingsViewer();
  return (
    <SettingsConsole pane="general" viewer={viewer}>
      <GeneralSettingsPane viewer={viewer} />
    </SettingsConsole>
  );
}
