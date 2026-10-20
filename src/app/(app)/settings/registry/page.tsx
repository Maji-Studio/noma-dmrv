/**
 * Settings, Registry. Every member can read the registry status and Source
 * visibility; the keys form mounts only for Owners and Admins, and the
 * credential and visibility actions check the role again.
 */
import { RegistrySettingsPane, SettingsConsole } from "@/components/settings";
import { loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function RegistrySettingsPage() {
  const { viewer } = await loadSettingsViewer();
  return (
    <SettingsConsole pane="registry" viewer={viewer}>
      <RegistrySettingsPane viewer={viewer} />
    </SettingsConsole>
  );
}
