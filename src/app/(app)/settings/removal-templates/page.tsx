/**
 * Settings, Removal templates, for the working facility. Answers with the
 * Registry pane while the organization has no registry keys saved.
 */
import { RemovalTemplatesSettingsPane, SettingsConsole } from "@/components/settings";
import type { SettingsSearchParams } from "@/lib/settings/links";
import { assertSettingsPaneVisible, loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function RemovalTemplatesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  const { viewer } = await loadSettingsViewer();
  assertSettingsPaneVisible(viewer, "removal-templates", await searchParams);
  return (
    <SettingsConsole pane="removal-templates" viewer={viewer}>
      <RemovalTemplatesSettingsPane viewer={viewer} />
    </SettingsConsole>
  );
}
