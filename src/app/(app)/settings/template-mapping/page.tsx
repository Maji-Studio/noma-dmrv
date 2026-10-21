/**
 * Settings, Template mapping (Platform Admins): the working facility's
 * Removal template mapping and compilation traces, read-only.
 */
import { SettingsConsole, TemplateMappingSettingsPane } from "@/components/settings";
import { assertSettingsPaneVisible, loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function TemplateMappingSettingsPage() {
  const { viewer } = await loadSettingsViewer();
  assertSettingsPaneVisible(viewer, "template-mapping");
  return (
    <SettingsConsole pane="template-mapping" viewer={viewer}>
      <TemplateMappingSettingsPane />
    </SettingsConsole>
  );
}
