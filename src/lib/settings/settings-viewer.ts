/**
 * The server half of every settings route: who is looking, and whether the
 * pane they asked for is one they may open. Server only (it reads the session
 * and the database); the console receives the result as a plain prop.
 */
import { notFound, redirect } from "next/navigation";
import { canOwnApiKey } from "@/lib/auth/api-scopes";
import { getOrgContext, hasOrgRole, requireAuth, type OrgContext } from "@/lib/auth/server";
import { readActiveOrganization } from "@/lib/read-models";
// Not in the read-models barrel: it reaches the database through data-access
// directly, and the barrel is imported by modules that must not load it.
import { readOrganizationRegistryStatus } from "@/lib/read-models/organization-registry-status";
import {
  redirectPreservingQuery,
  SETTINGS_REGISTRY_HREF,
  type SettingsSearchParams,
} from "./links";
import {
  settingsPane,
  settingsPaneHiddenReason,
  type SettingsPaneKey,
  type SettingsViewer,
  type OrganizationSettingsViewer,
} from "./panes";

export type { SettingsViewer } from "./panes";

/** Where a signed-in caller without an active organization resolves one. */
const NO_ORGANIZATION_HREF = "/dashboard";

export function loadSettingsViewer(): Promise<{ ctx: OrgContext; viewer: OrganizationSettingsViewer }>;
export function loadSettingsViewer(scope: "profile"): Promise<{ ctx: OrgContext | null; viewer: SettingsViewer }>;
export async function loadSettingsViewer(scope?: "profile"): Promise<{ ctx: OrgContext | null; viewer: SettingsViewer }> {
  const ctx = await getOrgContext();
  // No active organization selected: the dashboard's switcher resolves one.
  if (!ctx) {
    if (scope !== "profile") redirect(NO_ORGANIZATION_HREF);
    const user = await requireAuth();
    return {
      ctx: null,
      viewer: {
        organizationId: null,
        organizationName: null,
        isPlatformAdmin: user.role === "admin",
        canManage: false,
        canManageApiKeys: false,
        registryKeysSaved: false,
        isProduction: false,
      },
    };
  }

  const [organization, registry] = await Promise.all([
    readActiveOrganization(ctx),
    readOrganizationRegistryStatus(ctx),
  ]);

  return {
    ctx,
    viewer: {
      organizationId: ctx.organizationId,
      organizationName: organization?.name ?? "This organization",
      isPlatformAdmin: ctx.isPlatformAdmin,
      canManage: hasOrgRole(ctx, "admin"),
      canManageApiKeys: canOwnApiKey(ctx.orgRole),
      registryKeysSaved: registry.keysSaved,
      isProduction: registry.isProduction,
    },
  };
}

/**
 * Stops a request for a pane this viewer does not see. A pane outside the
 * viewer's audience is a 404, like any page that is not theirs. A pane that
 * waits on registry keys answers with the Registry pane, which says what saving
 * the keys unlocks, and keeps `?facility=`.
 */
export function assertSettingsPaneVisible(
  viewer: SettingsViewer,
  key: SettingsPaneKey,
  searchParams: SettingsSearchParams = {},
): void {
  const reason = settingsPaneHiddenReason(settingsPane(key), viewer);
  if (reason === "no-organization") redirect(NO_ORGANIZATION_HREF);
  if (reason === "audience") notFound();
  if (reason === "registry-keys") {
    redirect(redirectPreservingQuery(SETTINGS_REGISTRY_HREF, searchParams));
  }
}
