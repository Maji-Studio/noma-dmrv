/**
 * Settings, Diagnostics (Platform Admins): read-only environment, credential
 * and allowlist status. The health action checks the platform role again.
 */
import { CertificationHealthPanel } from "@/components/certification/certification-health-panel";
import { SettingsConsole } from "@/components/settings";
import { assertSettingsPaneVisible, loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function DiagnosticsSettingsPage() {
  const { viewer } = await loadSettingsViewer();
  assertSettingsPaneVisible(viewer, "diagnostics");
  return (
    <SettingsConsole pane="diagnostics" viewer={viewer}>
      <CertificationHealthPanel />
    </SettingsConsole>
  );
}
