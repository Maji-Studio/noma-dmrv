/**
 * The panes of the settings console and who sees them. Pure, so the rail, the
 * route guards and the tests read one list.
 *
 * The rail groups panes by whose setting it is (#1277, variant A): You, the
 * Organization, its Certification, and the Platform. A pane is a route.
 */
import {
  ADMIN_ORGANIZATIONS_HREF,
  SETTINGS_CONNECTED_APPS_HREF,
  SETTINGS_DEVELOPERS_HREF,
  SETTINGS_DIAGNOSTICS_HREF,
  SETTINGS_FACILITIES_HREF,
  SETTINGS_GENERAL_HREF,
  SETTINGS_MEMBERS_HREF,
  SETTINGS_REGISTRY_HREF,
  SETTINGS_REMOVAL_TEMPLATES_HREF,
  SETTINGS_TEMPLATE_MAPPING_HREF,
} from "./links";

/**
 * The organization roles that may change organization settings, as one phrase.
 * Every access line below is built from it, so renaming the roles is one edit.
 */
export const ORGANIZATION_SETTINGS_ROLES = "Admins";

export const SETTINGS_ACCESS = {
  organization: `${ORGANIZATION_SETTINGS_ROLES} can change these.`,
  you: `You and organization ${ORGANIZATION_SETTINGS_ROLES} can change these.`,
  platformReadOnly: "Read-only for Platform Admins.",
} as const;

export type SettingsGroupKey = "you" | "organization" | "certification" | "platform";

export const SETTINGS_GROUP_ORDER: readonly SettingsGroupKey[] = [
  "you",
  "organization",
  "certification",
  "platform",
];

export const SETTINGS_GROUP_LABELS: Record<SettingsGroupKey, string> = {
  you: "You",
  organization: "Organization",
  certification: "Certification",
  platform: "Platform",
};

export type SettingsPaneKey =
  | "connected-apps"
  | "general"
  | "members"
  | "developers"
  | "registry"
  | "removal-templates"
  | "facilities"
  | "organizations"
  | "diagnostics"
  | "template-mapping";

/** What a pane's settings apply to. Drives the scope line at the top of the pane. */
export type SettingsPaneScope = "you" | "organization" | "facility" | "platform";

type SettingsPaneAudience = "everyone" | "api-key-owners" | "platform-admins";

export interface SettingsPaneMeta {
  key: SettingsPaneKey;
  group: SettingsGroupKey;
  /** Rail label and page title. */
  label: string;
  href: string;
  scope: SettingsPaneScope;
  /** The pane's first line, explaining what it configures. */
  caption: string;
  /** The pane footnote: who may change what is in it. */
  access: string;
  audience: SettingsPaneAudience;
  /** Hidden until the organization has registry keys saved. */
  needsRegistryKeys?: boolean;
  /** A link to a page outside the console (it has no pane of its own). */
  external?: boolean;
}

export const SETTINGS_PANES: readonly SettingsPaneMeta[] = [
  {
    key: "connected-apps",
    group: "you",
    label: "Connected apps",
    href: SETTINGS_CONNECTED_APPS_HREF,
    scope: "you",
    caption: "Apps you have allowed to act for you in this organization.",
    access: SETTINGS_ACCESS.you,
    audience: "everyone",
  },
  {
    key: "general",
    group: "organization",
    label: "General",
    href: SETTINGS_GENERAL_HREF,
    scope: "organization",
    caption: "The organization, and what new facilities and records start with. Every value stays editable on the record itself.",
    access: SETTINGS_ACCESS.organization,
    audience: "everyone",
  },
  {
    key: "members",
    group: "organization",
    label: "Members",
    href: SETTINGS_MEMBERS_HREF,
    scope: "organization",
    caption: "Who can sign in to this organization, and what each of them may change.",
    access: SETTINGS_ACCESS.organization,
    audience: "everyone",
  },
  {
    key: "developers",
    group: "organization",
    label: "Developers",
    href: SETTINGS_DEVELOPERS_HREF,
    scope: "organization",
    caption: "A key acts as its owner, limited to the permissions you select.",
    access: SETTINGS_ACCESS.organization,
    audience: "api-key-owners",
  },
  {
    key: "registry",
    group: "certification",
    label: "Registry",
    href: SETTINGS_REGISTRY_HREF,
    scope: "organization",
    caption: "The registry your Removals are certified with, its organization-wide keys and the Source visibility policy.",
    access: SETTINGS_ACCESS.organization,
    audience: "everyone",
  },
  {
    key: "removal-templates",
    group: "certification",
    label: "Removal templates",
    href: SETTINGS_REMOVAL_TEMPLATES_HREF,
    scope: "facility",
    caption: "The template this facility's credit batches use. Component decisions apply to every facility using the template.",
    access: SETTINGS_ACCESS.organization,
    audience: "everyone",
    needsRegistryKeys: true,
  },
  {
    key: "facilities",
    group: "certification",
    label: "Facilities",
    href: SETTINGS_FACILITIES_HREF,
    scope: "facility",
    caption: "The facility's registry project, its durability tier and its soil reference temperature.",
    access: SETTINGS_ACCESS.organization,
    audience: "everyone",
    needsRegistryKeys: true,
  },
  {
    key: "organizations",
    group: "platform",
    label: "Organizations",
    href: ADMIN_ORGANIZATIONS_HREF,
    scope: "platform",
    // PROTOTYPE (#1373, variant D): a real pane needs a caption and footnote.
    caption: "Every organization on noma: open one, its Isometric keys and its API access.",
    access: "Platform Admins only.",
    audience: "platform-admins",
    external: true,
  },
  {
    key: "diagnostics",
    group: "platform",
    label: "Diagnostics",
    href: SETTINGS_DIAGNOSTICS_HREF,
    scope: "platform",
    caption: "Read-only environment, credential and allowlist status. Never exposes tokens.",
    access: SETTINGS_ACCESS.platformReadOnly,
    audience: "platform-admins",
  },
  {
    key: "template-mapping",
    group: "platform",
    label: "Template mapping",
    href: SETTINGS_TEMPLATE_MAPPING_HREF,
    scope: "facility",
    caption: "Read-only mapping and Removal compilation traces for this facility's active Isometric Removal template.",
    access: SETTINGS_ACCESS.platformReadOnly,
    audience: "platform-admins",
  },
];

/** What decides which panes a viewer sees. */
export interface SettingsPaneAccess {
  isPlatformAdmin: boolean;
  /** A live Admin membership. Platform status grants no override. */
  canManageApiKeys: boolean;
  registryKeysSaved: boolean;
}

/** Who is looking at the console, resolved on the server for every settings route. */
export interface SettingsViewer extends SettingsPaneAccess {
  organizationId: string;
  organizationName: string;
  /** Admin in the organization, or a Platform Admin. */
  canManage: boolean;
  /** As loaded; the console follows the live credential status for managers. */
  registryKeysSaved: boolean;
  /** Which Isometric environment registry writes land in. */
  isProduction: boolean;
}

export function settingsPane(key: SettingsPaneKey): SettingsPaneMeta {
  const pane = SETTINGS_PANES.find((candidate) => candidate.key === key);
  if (!pane) throw new Error(`Unknown settings pane: ${key}`);
  return pane;
}

/** Why a pane is not shown to this viewer, or null when it is. */
export function settingsPaneHiddenReason(
  pane: SettingsPaneMeta,
  access: SettingsPaneAccess,
): "audience" | "registry-keys" | null {
  if (pane.audience === "platform-admins" && !access.isPlatformAdmin) return "audience";
  if (pane.audience === "api-key-owners" && !(access.canManageApiKeys || access.isPlatformAdmin)) {
    return "audience";
  }
  // Settings that do not apply yet are hidden, not shown as "Not used" (Q11).
  // The Registry pane says what saving the keys unlocks.
  if (pane.needsRegistryKeys && !access.registryKeysSaved) return "registry-keys";
  return null;
}

export function visibleSettingsPanes(access: SettingsPaneAccess): SettingsPaneMeta[] {
  return SETTINGS_PANES.filter((pane) => settingsPaneHiddenReason(pane, access) === null);
}

export interface SettingsPaneGroup {
  key: SettingsGroupKey;
  label: string;
  panes: SettingsPaneMeta[];
}

/** The visible panes in rail order, grouped, with empty groups left out. */
export function settingsPaneGroups(access: SettingsPaneAccess): SettingsPaneGroup[] {
  const visible = visibleSettingsPanes(access);
  return SETTINGS_GROUP_ORDER.map((key) => ({
    key,
    label: SETTINGS_GROUP_LABELS[key],
    panes: visible.filter((pane) => pane.group === key),
  })).filter((group) => group.panes.length > 0);
}
