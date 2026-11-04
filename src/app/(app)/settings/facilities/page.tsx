/**
 * Settings, Facilities: the working facility's registry project link,
 * durability tier and soil reference temperature. Answers with the Registry
 * pane while the organization has no registry keys saved.
 */
import { FacilitySettingsPane, SettingsConsole } from "@/components/settings";
import type { SettingsSearchParams } from "@/lib/settings/links";
import { assertSettingsPaneVisible, loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function FacilitySettingsPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  const { viewer } = await loadSettingsViewer();
  assertSettingsPaneVisible(viewer, "facilities", await searchParams);
  return (
    <SettingsConsole pane="facilities" viewer={viewer}>
      <FacilitySettingsPane viewer={viewer} />
    </SettingsConsole>
  );
}
