/**
 * SettingsConsole — the frame every `/settings` page renders inside.
 *
 * One console for every setting (#1277, variant A): a rail grouped by whose
 * setting it is (You, the Organization, its Certification, the Platform) plus
 * one pane. Each pane is its own route, so it can be bookmarked and each
 * route checks its own access on the server (`assertSettingsPaneVisible`).
 * `/certification/settings` folded in here and only redirects now.
 *
 * The pane card carries three lines the rail cannot: the scope line on top
 * (whose settings these are, and for facility panes which facility), the
 * caption saying what the pane configures, and the footnote saying who may
 * change it.
 *
 * Panes with drafts report their dirty state through `FormDialogContext`, so
 * leaving through the rail asks before a draft is dropped, as the in-place
 * certification panes did.
 *
 * The rail is the hub, which is why `/settings` has no landing page: a tile
 * grid whose tiles are also permanently in the rail is the thing `/admin` was.
 */
"use client";

import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  BuildingsIcon,
  CertificateIcon,
  CodeIcon,
  FactoryIcon,
  ListChecksIcon,
  PlugsConnectedIcon,
  SlidersHorizontalIcon,
  UserCircleIcon,
  UserIcon,
  UsersIcon,
} from "@phosphor-icons/react/dist/ssr";
import { EnvBanner } from "@/components/certification/env-banner";
import { useUnsavedPaneGuard } from "@/components/certification/use-unsaved-pane-guard";
import { PageHeader, SettingsRail, type SettingsRailGroup } from "@/components/ui";
import { FormDialogContext } from "@/components/ui/form-dialog-context";
import { useFacilityCertifierSummary } from "@/hooks/use-certification";
import { useOrgCertifierCredentialsStatus } from "@/hooks/use-certifier-credentials";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { withFacilityParam } from "@/lib/settings/links";
import {
  settingsPane,
  settingsPaneGroups,
  type SettingsPaneKey,
  type SettingsPaneMeta,
  type SettingsPaneScope,
  type SettingsViewer,
} from "@/lib/settings/panes";

/** A rail plus a form pane stops being readable past roughly this width. */
export const SETTINGS_CONSOLE_MAX_WIDTH_CLASS = "max-w-[1160px]";

const PANE_ICONS: Record<SettingsPaneKey, Icon> = {
  profile: UserIcon,
  "connected-apps": PlugsConnectedIcon,
  general: SlidersHorizontalIcon,
  members: UsersIcon,
  developers: CodeIcon,
  registry: CertificateIcon,
  "removal-templates": ListChecksIcon,
  facilities: FactoryIcon,
};

const SCOPE_ICONS: Record<SettingsPaneScope, Icon> = {
  you: UserCircleIcon,
  organization: BuildingsIcon,
  facility: FactoryIcon,
};

/** The facility panes configure the working facility, chosen in the sidebar (Q14). */
const WORKING_FACILITY_NOTE = "The working facility. Change it with the facility selector.";

interface SettingsConsoleProps {
  pane: SettingsPaneKey;
  viewer: SettingsViewer;
  /** Optional. Only when it says something the title and caption do not. */
  subtitle?: string;
  children: ReactNode;
}

/**
 * Whether the organization has registry keys. Managers follow the live
 * credential status, so saving the first keys shows the panes they unlock
 * without a reload; members cannot read it and keep the server's answer.
 */
function useRegistryKeysSaved(viewer: SettingsViewer): boolean {
  const { data } = useOrgCertifierCredentialsStatus(
    viewer.organizationId,
    viewer.canManage,
  );
  return data?.configured ?? viewer.registryKeysSaved;
}

export function SettingsConsole({ pane: paneKey, viewer, subtitle, children }: SettingsConsoleProps) {
  const router = useRouter();
  const guard = useUnsavedPaneGuard();
  const { facilityId, selectedFacility } = useFacilityContext();
  const registryKeysSaved = useRegistryKeysSaved(viewer);
  const { data: summary } = useFacilityCertifierSummary(facilityId ?? "", !!facilityId);

  const pane = settingsPane(paneKey);
  const groups = settingsPaneGroups({ ...viewer, registryKeysSaved });

  // A dot only where the fix is in that pane, and only once the answer is in:
  // a dot that flashes while a query loads and then goes away is noise.
  const needsAttention = (key: SettingsPaneKey): boolean => {
    if (key === "registry") return viewer.canManage && !registryKeysSaved;
    if (key === "facilities") return !!summary && !summary.mapping;
    return false;
  };

  const railGroups: SettingsRailGroup[] = groups.map((group) => ({
    key: group.key,
    label: group.label,
    detail: group.key === "organization" ? viewer.organizationName : undefined,
    items: group.panes.map((item) => ({
      key: item.key,
      label: item.label,
      href: withFacilityParam(item.href, facilityId),
      icon: PANE_ICONS[item.key],
      needsAttention: needsAttention(item.key),
    })),
  }));

  const facilityName = selectedFacility?.name?.trim() || selectedFacility?.code;

  return (
    <div className="container-max page-shell">
      <div className={`${SETTINGS_CONSOLE_MAX_WIDTH_CLASS} flex flex-col gap-16`}>
        <PageHeader eyebrow="Settings" title={pane.label} subtitle={subtitle} />
        {/* Which Isometric environment a write lands in is a property of the
            whole integration, so every Certification pane carries it. */}
        {pane.group === "certification" && <EnvBanner isProduction={viewer.isProduction} />}
      </div>

      <div
        className={`${SETTINGS_CONSOLE_MAX_WIDTH_CLASS} grid gap-24 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start`}
      >
        <SettingsRail
          groups={railGroups}
          selectedKey={pane.key}
          onNavigate={(href) => guard.requestLeave(() => router.push(href))}
          ariaLabel="Settings categories"
          idPrefix="settings"
          currentLabel={pane.label}
        />

        {/* A presentational card, so a plain div: as a `section` it became an
            ancestor of every pane's own sections, and a `section`-scoped query
            for one of them silently widened to the whole pane. */}
        <div className="min-w-0 border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
          <ScopeLine pane={pane} organizationName={viewer.organizationName} facilityName={facilityName} />

          <FormDialogContext.Provider value={guard.actions}>
            <div className="flex flex-col gap-24 p-16 sm:p-24">
              <p className="body-small text-[var(--color-text-secondary)]">{pane.caption}</p>
              {children}
            </div>
          </FormDialogContext.Provider>

          <div className="border-t-[1px] border-[var(--clr-dark-purple-10)] px-16 py-12 sm:px-24">
            <span className="body-caption text-[var(--color-text-tertiary)]">{pane.access}</span>
          </div>
        </div>
      </div>
      {guard.dialog}
    </div>
  );
}

/** Whose settings the pane holds. Facility panes name the working facility. */
function ScopeLine({
  pane,
  organizationName,
  facilityName,
}: {
  pane: SettingsPaneMeta;
  organizationName: string;
  facilityName: string | undefined;
}) {
  const ScopeIcon = SCOPE_ICONS[pane.scope];
  const title =
    pane.scope === "you"
      ? "You"
      : pane.scope === "organization"
        ? organizationName
        : (facilityName ?? "No facility selected");

  return (
    <div className="flex items-start gap-8 border-b-[1px] border-[var(--clr-dark-purple-10)] px-16 py-12 sm:px-24">
      <ScopeIcon
        size={16}
        weight="bold"
        aria-hidden
        className="mt-2 shrink-0 text-[var(--color-text-tertiary)]"
      />
      <p className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-8">
        <span className="body-small text-[var(--color-text-secondary)]">{title}</span>
        {pane.scope === "facility" && facilityName && (
          <span className="body-caption text-[var(--color-text-tertiary)]">{WORKING_FACILITY_NOTE}</span>
        )}
      </p>
    </div>
  );
}
