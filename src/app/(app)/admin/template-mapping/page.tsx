/**
 * Platform: Template mapping. The working facility's Removal template mapping
 * and compilation traces, read-only. Moved from Settings next to Organizations
 * (#1373); it still follows the sidebar's working facility, in the
 * organization you are working in. The admin layout's requireAdmin() guards it.
 */
import { TemplateMappingSettingsPane } from "@/components/settings";
import { TemplateMappingScope } from "@/components/settings/template-mapping-scope";
import { PageHeader } from "@/components/ui";

export default function PlatformTemplateMappingPage() {
  return (
    <div className="container-max page-shell">
      <PageHeader
        eyebrow="Platform"
        title="Template mapping"
        subtitle="The working facility's Isometric Removal template mapping and compilation traces. Read only."
      />
      <TemplateMappingScope />
      <TemplateMappingSettingsPane />
    </div>
  );
}
