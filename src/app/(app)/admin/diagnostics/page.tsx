/**
 * Platform: Diagnostics. Read-only environment, credential and allowlist
 * status; never exposes tokens. Moved from Settings next to Organizations
 * (#1373). The admin layout's requireAdmin() guards it and the health action
 * checks the platform role again.
 */
import { CertificationHealthPanel } from "@/components/certification/certification-health-panel";
import { PageHeader } from "@/components/ui";

export default function PlatformDiagnosticsPage() {
  return (
    <div className="container-max page-shell">
      <PageHeader eyebrow="Platform" title="Diagnostics" subtitle="Environment, credential and allowlist status. Read only." />
      <CertificationHealthPanel />
    </div>
  );
}
