/**
 * Platform: Organizations. Platform Admins list every organization, open any
 * one (sets the session's active org), and create the first org. Access is
 * gated by the parent admin layout's requireAdmin() guard.
 *
 * PROTOTYPE (#1373, branch prototype/platform-organizations, never merge):
 * `?variant=A..D` swaps the rendering; no variant renders today's page.
 */
import { PageHeader } from "@/components/ui";
import { OrganizationsAdmin } from "@/components/organizations/organizations-admin";
import { OrganizationsPrototype } from "@/components/organizations/prototype/organizations-prototype";
import { VariantD } from "@/components/organizations/prototype/variant-d";
import { PrototypeSwitcher } from "@/components/organizations/prototype/prototype-switcher";
import { SettingsConsole } from "@/components/settings";
import { loadSettingsViewer } from "@/lib/settings/settings-viewer";

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  const { variant } = await searchParams;
  if (variant === "D") {
    const { viewer } = await loadSettingsViewer();
    return (
      <>
        <SettingsConsole pane="organizations" viewer={viewer}>
          <VariantD />
        </SettingsConsole>
        <PrototypeSwitcher current="D" />
      </>
    );
  }
  if (variant === "A" || variant === "B" || variant === "C") {
    return <OrganizationsPrototype variant={variant} />;
  }
  return (
    <div className="container-max page-shell">
      <PageHeader eyebrow="Platform" title="Organizations" />
      <OrganizationsAdmin />
      <PrototypeSwitcher current="today" />
    </div>
  );
}
