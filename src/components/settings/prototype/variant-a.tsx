"use client";

/**
 * Throwaway prototype variant A: one console by scope.
 *
 * `/settings` is the only settings place. One rail grouped by whose settings
 * they are: You, Organization, Facility (with a facility picker in the group
 * header), Platform (Platform Admins only). `/certification/settings` folds in,
 * Vehicles and crew moves to the sidebar as a list page. A Platform Admin
 * inside an organization sees a thin bar with the way back.
 */
import type { Icon } from "@phosphor-icons/react";
import type { ComponentType } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowUUpLeftIcon,
  BuildingsIcon,
  CertificateIcon,
  CloudIcon,
  CodeIcon,
  GlobeIcon,
  LinkIcon,
  MapPinAreaIcon,
  PlugsConnectedIcon,
  PulseIcon,
  ShieldStarIcon,
  SlidersHorizontalIcon,
  UserCircleIcon,
  UsersIcon,
  WarehouseIcon,
} from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { fixtures } from "./abd-fixtures";
import { enterAbdOrg, useAbdActiveOrg } from "./abd-active-org";
import { PrototypeViewerToggle } from "./abd-viewer-toggle";
import { setSettingsPrototypeParams } from "./use-settings-prototype-variant";
import {
  AConnectedAppsPane,
  ADevelopersPane,
  ADiagnosticsPane,
  AEmissionsPane,
  AGeneralPane,
  AMembersPane,
  AOrganizationsPane,
  AProfilePane,
  ARegistryLinkPane,
  ARegistryPane,
  ASitePane,
  type APaneProps,
} from "./variant-a-panes";

export const variantAName = "One console by scope";

type AScope = "you" | "organization" | "facility" | "platform";

interface APane {
  key: string;
  scope: AScope;
  label: string;
  icon: Icon;
  body: ComponentType<APaneProps>;
  attention?: boolean;
}

const PANES: readonly APane[] = [
  { key: "profile", scope: "you", label: "Profile", icon: UserCircleIcon, body: AProfilePane },
  { key: "connected-apps", scope: "you", label: "Connected apps", icon: PlugsConnectedIcon, body: AConnectedAppsPane },
  { key: "general", scope: "organization", label: "General", icon: SlidersHorizontalIcon, body: AGeneralPane },
  { key: "members", scope: "organization", label: "Members", icon: UsersIcon, body: AMembersPane },
  { key: "registry", scope: "organization", label: "Registry", icon: CertificateIcon, body: ARegistryPane, attention: true },
  { key: "developers", scope: "organization", label: "Developers", icon: CodeIcon, body: ADevelopersPane },
  { key: "site", scope: "facility", label: "Site", icon: MapPinAreaIcon, body: ASitePane },
  { key: "registry-link", scope: "facility", label: "Registry link", icon: LinkIcon, body: ARegistryLinkPane },
  { key: "emissions", scope: "facility", label: "Emissions", icon: CloudIcon, body: AEmissionsPane },
  { key: "organizations", scope: "platform", label: "Organizations", icon: BuildingsIcon, body: AOrganizationsPane },
  { key: "diagnostics", scope: "platform", label: "Diagnostics", icon: PulseIcon, body: ADiagnosticsPane },
];

const SCOPE_ORDER: readonly AScope[] = ["you", "organization", "facility", "platform"];
const SCOPE_ICON: Record<AScope, Icon> = {
  you: UserCircleIcon,
  organization: BuildingsIcon,
  facility: WarehouseIcon,
  platform: GlobeIcon,
};
const DEFAULT_PANE = "general";

function scopeTitle(scope: AScope, orgName: string, facilityName: string): string {
  switch (scope) {
    case "you":
      return "You";
    case "organization":
      return orgName;
    case "facility":
      return `Facility: ${facilityName}`;
    case "platform":
      return "Platform";
  }
}

function accessLine(scope: AScope): string {
  switch (scope) {
    case "you":
      return "Only you can change these.";
    case "organization":
    case "facility":
      return "Owners and Admins can change these.";
    case "platform":
      return "Platform Admins can change these.";
  }
}

export function VariantA() {
  const params = useSearchParams();
  const toast = useToast();
  const active = useAbdActiveOrg("a-org");
  const isPlatformAdmin = active.viewer === "platform-admin";

  const facility =
    fixtures.facilities.find((f) => f.id === params.get("a-facility")) ?? fixtures.facilities[0];
  const panes = PANES.filter((p) => p.scope !== "platform" || isPlatformAdmin);
  const pane = panes.find((p) => p.key === params.get("a-pane")) ?? panes.find((p) => p.key === DEFAULT_PANE)!;
  const goTo = (key: string) => setSettingsPrototypeParams({ "a-pane": key === DEFAULT_PANE ? null : key });
  const pickFacility = (id: string) =>
    setSettingsPrototypeParams({
      "a-facility": id === fixtures.facilities[0].id ? null : id,
      "a-pane": pane.scope === "facility" ? pane.key : "site",
    });
  const openOrg = (orgId: string) => {
    const org = fixtures.organizations.find((o) => o.id === orgId);
    enterAbdOrg("a-org", orgId, { "a-pane": null });
    toast.info(`Prototype: opened ${org?.name ?? "organization"}`);
  };

  const Body = pane.body;
  const ScopeIcon = SCOPE_ICON[pane.scope];

  return (
    <>
      {isPlatformAdmin && (
        <div className="flex flex-wrap items-center gap-x-16 gap-y-4 border-b border-[var(--st-wait-border)] bg-[var(--st-wait-bg)] px-16 py-8 md:px-32">
          <ShieldStarIcon size={16} weight="fill" className="shrink-0 text-[var(--st-wait)]" aria-hidden />
          <p className="body-small min-w-0 flex-1">
            You are in <span className="font-medium">{active.name}</span> as Platform Admin
          </p>
          <button
            type="button"
            onClick={() => goTo("organizations")}
            className="body-small inline-flex min-h-44 items-center gap-6 underline md:min-h-0"
          >
            <ArrowUUpLeftIcon size={14} weight="bold" aria-hidden />
            Back to organizations
          </button>
        </div>
      )}

      <div className="container-max page-shell">
        <div className="flex max-w-[1160px] flex-col gap-16 sm:flex-row sm:items-start sm:justify-between">
          <PageHeader eyebrow="Settings" title={pane.label} />
          <PrototypeViewerToggle />
        </div>

        <div className="grid max-w-[1160px] gap-24 lg:grid-cols-[256px_minmax(0,1fr)] lg:items-start">
          {/* Phone: one grouped select instead of the rail. */}
          <label className="flex flex-col gap-4 lg:hidden">
            <span className="body-small font-medium text-[var(--color-text-secondary)]">Settings page</span>
            <select
              value={pane.key}
              onChange={(event) => goTo(event.target.value)}
              className="h-44 w-full border border-[var(--color-border-secondary)] bg-[var(--paper)] px-12 text-[length:var(--text-s)]"
            >
              {SCOPE_ORDER.map((scope) => {
                const group = panes.filter((p) => p.scope === scope);
                if (group.length === 0) return null;
                return (
                  <optgroup key={scope} label={scopeTitle(scope, active.name, facility.name)}>
                    {group.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </label>

          <nav
            aria-label="Settings"
            className="hidden border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)] lg:sticky lg:top-24 lg:block"
          >
            {SCOPE_ORDER.map((scope) => {
              const group = panes.filter((p) => p.scope === scope);
              if (group.length === 0) return null;
              const GroupIcon = SCOPE_ICON[scope];
              return (
                <div key={scope} className="border-b-[1.5px] border-[var(--clr-dark-purple-40)] last:border-b-0">
                  <div className="flex flex-col gap-6 border-b border-[var(--clr-dark-purple-10)] px-12 py-10">
                    <span className="flex items-center gap-8">
                      <GroupIcon size={14} weight="bold" className="text-[var(--color-text-tertiary)]" aria-hidden />
                      <span className="body-caption font-medium text-[var(--color-text-secondary)]">
                        {scope === "you"
                          ? "You"
                          : scope === "organization"
                            ? "Organization"
                            : scope === "facility"
                              ? "Facility"
                              : "Platform"}
                      </span>
                    </span>
                    {scope === "organization" && (
                      <span className="body-small truncate pl-24">{active.name}</span>
                    )}
                    {scope === "facility" && (
                      <select
                        aria-label="Facility"
                        value={facility.id}
                        onChange={(event) => pickFacility(event.target.value)}
                        className="body-small h-32 w-full border border-[var(--color-border-secondary)] bg-[var(--paper)] px-8"
                      >
                        {fixtures.facilities.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <ul className="flex flex-col py-4">
                    {group.map((p) => {
                      const selected = p.key === pane.key;
                      const RowIcon = p.icon;
                      return (
                        <li key={p.key}>
                          <button
                            type="button"
                            onClick={() => goTo(p.key)}
                            aria-current={selected ? "page" : undefined}
                            className={`flex w-full items-center gap-10 border-l-[2px] py-10 pl-16 pr-12 text-left transition-colors ${
                              selected
                                ? "border-l-[var(--clr-red)] bg-[var(--sea)]"
                                : "border-l-transparent hover:bg-[var(--sea)]"
                            }`}
                          >
                            <RowIcon
                              size={16}
                              weight="bold"
                              className={selected ? "shrink-0 text-[var(--clr-red)]" : "shrink-0 text-[var(--color-text-tertiary)]"}
                              aria-hidden
                            />
                            <span className="body-small min-w-0 flex-1 truncate">{p.label}</span>
                            {p.attention && (
                              <span aria-label="Needs attention" className="size-6 shrink-0 rounded-full bg-[var(--st-wait)]" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>

          <div className="border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]">
            <div className="flex items-center gap-8 border-b border-[var(--clr-dark-purple-10)] px-16 py-12 sm:px-24">
              <ScopeIcon size={16} weight="bold" className="text-[var(--color-text-tertiary)]" aria-hidden />
              <span className="body-small text-[var(--color-text-secondary)]">
                {scopeTitle(pane.scope, active.name, facility.name)}
              </span>
            </div>
            <div className="p-16 sm:p-24">
              <Body active={active} facility={facility} goTo={goTo} openOrg={openOrg} />
            </div>
            <div className="border-t border-[var(--clr-dark-purple-10)] px-16 py-12 sm:px-24">
              <span className="body-caption text-[var(--color-text-tertiary)]">{accessLine(pane.scope)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
