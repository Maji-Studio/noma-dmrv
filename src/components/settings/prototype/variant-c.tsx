"use client";

/**
 * Throwaway: settings prototype variant C, "Settings index with live values".
 *
 * `/settings` is one searchable list of every setting: label, current value,
 * whose it is (scope chip) and who can change it. "Needs attention" sits on
 * top, chips filter by scope, a row opens a side sheet editor. No rail.
 * Org entry: a "Choose where to work" chooser replaces the silent pick at
 * sign-in, shown here as a screen state.
 */
import { useState, type ReactNode } from "react";
import {
  BuildingsIcon,
  CaretRightIcon,
  FactoryIcon,
  GearSixIcon,
  LockSimpleIcon,
  MagnifyingGlassIcon,
  UserIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Button, EmptyState, Input, Notice, PageHeader } from "@/components/ui";
import { SegmentedControl } from "@/components/forms";
import { cn } from "@/lib/utils";
import { VariantCChooser, type VariantCWorkspace } from "./variant-c-chooser";
import { VariantCSheet } from "./variant-c-sheet";
import {
  VARIANT_C_CHANGE_BY_LABEL,
  variantCFixtures,
  variantCScopeLabel,
  variantCSettings,
  type VariantCScope,
  type VariantCSetting,
  type VariantCViewer,
} from "./variant-c-fixtures";

export const variantCName = "Settings index";

const SCOPE_ICON: Record<VariantCScope, Icon> = {
  you: UserIcon,
  organization: BuildingsIcon,
  facility: FactoryIcon,
  platform: GearSixIcon,
};

const VIEWER_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "member", label: "Member" },
  { value: "platform", label: "Platform Admin" },
] as const;

const DEFAULT_ORG_ID = "mafinga";

type ScopeFilter = VariantCScope | "all";

function canChange(setting: VariantCSetting, viewer: VariantCViewer): boolean {
  if (setting.memberOnly && viewer === "platform") return false;
  switch (setting.changeBy) {
    case "you":
    case "allMembers":
      return true;
    case "ownerAdmin":
      return viewer !== "member";
    case "platformAdmin":
      return viewer === "platform";
  }
}

export function VariantC() {
  const [viewer, setViewer] = useState<VariantCViewer>("owner");
  const [workspace, setWorkspace] = useState<VariantCWorkspace>({ kind: "org", orgId: DEFAULT_ORG_ID });
  const [showChooser, setShowChooser] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const orgs = variantCFixtures.orgs;
  const org = workspace.kind === "org" ? orgs.find((o) => o.id === workspace.orgId) ?? orgs[0] : null;
  const facilityName = org?.facilities[0] ?? "Mafinga";
  const orgName = org?.name ?? "Platform";
  const role = org ? org.roleFor[viewer] : null;
  const isGuestAdmin = viewer === "platform" && org !== null && role === null;

  // What this viewer sees in this workspace, with the org-specific values in.
  const all = variantCSettings(viewer, orgName, facilityName)
    .map((setting) =>
      setting.id === "isometric-keys" && org && org.id !== DEFAULT_ORG_ID
        ? { ...setting, value: "Saved 2 Oct", attention: undefined }
        : setting,
    )
    .filter((setting) => {
      if (workspace.kind === "platform") {
        return (setting.scope === "you" && !setting.memberOnly) || setting.group === "Platform";
      }
      if (setting.group === "Platform") return viewer === "platform";
      return true;
    });

  const scopes = (["you", "organization", "facility", "platform"] as const).filter((s) =>
    all.some((setting) => setting.scope === s),
  );
  const needle = query.trim().toLowerCase();
  const visible = all.filter((setting) => {
    if (scope !== "all" && setting.scope !== scope) return false;
    if (!needle) return true;
    return [setting.label, setting.value, setting.group, variantCScopeLabel(setting.scope, facilityName)]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const attention = visible.filter((setting) => setting.attention);
  const groups = [...new Set(visible.map((setting) => setting.group))];
  const openSetting = all.find((setting) => setting.id === openId) ?? null;

  const chooseViewer = (next: VariantCViewer) => {
    setViewer(next);
    if (next !== "platform" && workspace.kind === "platform") {
      setWorkspace({ kind: "org", orgId: DEFAULT_ORG_ID });
    }
    if (scope === "platform" && next !== "platform") setScope("all");
  };

  const choose = (next: VariantCWorkspace) => {
    setWorkspace(next);
    setShowChooser(false);
    setOpenId(null);
    setScope("all");
  };

  const scopeTitle = (setting: VariantCSetting) => {
    if (setting.scope === "organization") return `Organization: ${orgName}`;
    if (setting.scope === "you") return "Your account";
    return variantCScopeLabel(setting.scope, facilityName);
  };

  return (
    <div className="container-max page-shell pb-96">
      <PrototypeStrip
        viewer={viewer}
        onViewer={chooseViewer}
        showChooser={showChooser}
        onToggleChooser={() => setShowChooser((value) => !value)}
      />

      {showChooser ? (
        <VariantCChooser viewer={viewer} orgs={orgs} current={workspace} onChoose={choose} />
      ) : (
        <>
          <PageHeader
            title="Settings"
            actions={
              <WorkspaceBadge
                name={orgName}
                role={workspace.kind === "platform" ? "Platform Admin" : role ?? "Platform Admin"}
                icon={workspace.kind === "platform" ? GearSixIcon : BuildingsIcon}
                onSwitch={() => setShowChooser(true)}
              />
            }
          />

          {isGuestAdmin && (
            <Notice
              tone="info"
              title={`You are in ${orgName} as Platform Admin`}
              action={
                <Button size="small" onClick={() => choose({ kind: "platform" })}>
                  Back to Platform
                </Button>
              }
            >
              You are not a member here. Members, registry and defaults are yours to change; API keys and connected apps
              belong to members.
            </Notice>
          )}

          <div className="flex flex-col gap-12">
            <div className="relative max-w-[480px]">
              <MagnifyingGlassIcon
                size={16}
                weight="bold"
                aria-hidden
                className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
              />
              <Input
                type="search"
                aria-label="Search settings"
                placeholder="Search settings"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="pl-36"
              />
            </div>
            <div role="group" aria-label="Filter by scope" className="flex flex-wrap gap-8">
              <ScopeChipButton label="All" pressed={scope === "all"} onClick={() => setScope("all")} />
              {scopes.map((s) => (
                <ScopeChipButton
                  key={s}
                  label={variantCScopeLabel(s, facilityName)}
                  pressed={scope === s}
                  onClick={() => setScope(s)}
                />
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              padding="md"
              icon={<MagnifyingGlassIcon size={40} weight="bold" />}
              title="No settings match"
              description="Try another word or clear the filter."
              action={
                <Button
                  onClick={() => {
                    setQuery("");
                    setScope("all");
                  }}
                >
                  Clear search
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-24">
              {attention.length > 0 && (
                <SettingsPanel title="Needs attention" titleIcon={WarningIcon}>
                  {attention.map((setting) => (
                    <SettingRow
                      key={`attention-${setting.id}`}
                      label={setting.attention ?? setting.label}
                      value={setting.label}
                      scopeLabel={variantCScopeLabel(setting.scope, facilityName)}
                      scope={setting.scope}
                      who={VARIANT_C_CHANGE_BY_LABEL[setting.changeBy]}
                      locked={!canChange(setting, viewer)}
                      warning={false}
                      onOpen={() => setOpenId(setting.id)}
                    />
                  ))}
                </SettingsPanel>
              )}
              {groups.map((group) => (
                <SettingsPanel key={group} title={group}>
                  {visible
                    .filter((setting) => setting.group === group)
                    .map((setting) => (
                      <SettingRow
                        key={setting.id}
                        label={setting.label}
                        value={setting.value}
                        scopeLabel={variantCScopeLabel(setting.scope, facilityName)}
                        scope={setting.scope}
                        who={VARIANT_C_CHANGE_BY_LABEL[setting.changeBy]}
                        locked={!canChange(setting, viewer)}
                        warning={Boolean(setting.attention)}
                        onOpen={() => setOpenId(setting.id)}
                      />
                    ))}
                </SettingsPanel>
              ))}
            </div>
          )}
        </>
      )}

      <VariantCSheet
        setting={openSetting}
        scopeTitle={openSetting ? scopeTitle(openSetting) : ""}
        canChange={openSetting ? canChange(openSetting, viewer) : false}
        viewer={viewer}
        orgName={orgName}
        orgs={orgs}
        onClose={() => setOpenId(null)}
        onOpenOrg={(orgId) => choose({ kind: "org", orgId })}
      />
    </div>
  );
}

function PrototypeStrip({
  viewer,
  onViewer,
  showChooser,
  onToggleChooser,
}: {
  viewer: VariantCViewer;
  onViewer: (viewer: VariantCViewer) => void;
  showChooser: boolean;
  onToggleChooser: () => void;
}) {
  return (
    <div className="flex flex-col gap-12 border border-dashed border-[var(--color-border-secondary)] px-16 py-12 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-8 md:flex-row md:items-center md:gap-12">
        <span className="body-caption font-medium text-[var(--color-text-tertiary)]">Prototype. View as</span>
        <SegmentedControl
          legend="View as"
          options={VIEWER_OPTIONS}
          value={viewer}
          onValueChange={(value) => onViewer(value as VariantCViewer)}
          className="md:w-[400px]"
        />
      </div>
      <Button size="small" variant="weak" onClick={onToggleChooser} aria-pressed={showChooser}>
        {showChooser ? "Hide sign-in chooser" : "Show sign-in chooser"}
      </Button>
    </div>
  );
}

function WorkspaceBadge({
  name,
  role,
  icon: BadgeIcon,
  onSwitch,
}: {
  name: string;
  role: string;
  icon: Icon;
  onSwitch: () => void;
}) {
  return (
    <div className="flex max-w-full items-center gap-12 border-[1.5px] border-[var(--clr-dark-purple-20)] bg-[var(--paper)] py-4 pl-12 pr-4">
      <BadgeIcon size={20} weight="bold" aria-hidden className="shrink-0 text-[var(--color-text-secondary)]" />
      <div className="flex min-w-0 flex-col">
        <span className="body-small font-medium truncate">{name}</span>
        <span className="body-caption text-[var(--color-text-tertiary)]">{role}</span>
      </div>
      <Button size="small" variant="noOutline" onClick={onSwitch}>
        Switch
      </Button>
    </div>
  );
}

function ScopeChipButton({ label, pressed, onClick }: { label: string; pressed: boolean; onClick: () => void }) {
  return (
    <Button size="small" variant={pressed ? "primary" : "weak"} aria-pressed={pressed} onClick={onClick}>
      {label}
    </Button>
  );
}

function SettingsPanel({
  title,
  titleIcon: TitleIcon,
  children,
}: {
  title: string;
  titleIcon?: Icon;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]"
    >
      <h2 className="flex items-center gap-8 border-b border-[var(--clr-dark-purple-10)] bg-[var(--sea)] px-16 py-10 body-small font-medium text-[var(--color-text-secondary)]">
        {TitleIcon && <TitleIcon size={16} weight="fill" aria-hidden className="text-[var(--st-wait)]" />}
        {title}
      </h2>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

function SettingRow({
  label,
  value,
  scope,
  scopeLabel,
  who,
  locked,
  warning,
  onOpen,
}: {
  label: string;
  value: string;
  scope: VariantCScope;
  scopeLabel: string;
  who: string;
  locked: boolean;
  warning: boolean;
  onOpen: () => void;
}) {
  const ScopeIcon = SCOPE_ICON[scope];
  return (
    <li className="border-b border-[var(--clr-dark-purple-10)] last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "grid w-full min-h-56 grid-cols-[minmax(0,1fr)_16px] items-center gap-x-12 gap-y-4 px-16 py-10 text-left transition-colors",
          "hover:bg-[var(--sea)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-interaction)]",
          "md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_176px_168px_16px]",
        )}
      >
        <span className="body-small font-medium min-w-0">{label}</span>
        <CaretRightIcon
          size={16}
          weight="bold"
          aria-hidden
          className="col-start-2 row-start-1 text-[var(--color-text-tertiary)] md:col-start-5"
        />
        <span
          className={cn(
            "body-small min-w-0 truncate md:col-start-2 md:row-start-1",
            warning ? "text-[var(--st-wait)]" : "text-[var(--color-text-secondary)]",
          )}
        >
          {value}
        </span>
        <span className="col-start-1 flex flex-wrap items-center gap-x-12 gap-y-4 md:contents">
          <span className="inline-flex w-fit items-center gap-6 rounded-full bg-[var(--clr-dark-purple-5)] px-8 py-2 body-caption text-[var(--color-text-secondary)] md:col-start-3 md:row-start-1">
            <ScopeIcon size={16} weight="bold" aria-hidden />
            {scopeLabel}
          </span>
          <span className="inline-flex items-center gap-6 body-caption text-[var(--color-text-tertiary)] md:col-start-4 md:row-start-1">
            {locked && <LockSimpleIcon size={16} weight="bold" aria-label="You cannot change this" />}
            {who}
          </span>
        </span>
      </button>
    </li>
  );
}
