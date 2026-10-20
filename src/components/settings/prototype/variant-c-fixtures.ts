/**
 * Throwaway fixtures for settings prototype variant C (settings index with
 * live values). Nothing here is read from or written to the database.
 */

export type VariantCScope = "you" | "organization" | "facility" | "platform";

/** Who is looking at the prototype. Local state, switched in the prototype strip. */
export type VariantCViewer = "owner" | "member" | "platform";

/** Who may change a setting. */
export type VariantCChangeBy = "you" | "ownerAdmin" | "allMembers" | "platformAdmin";

export type VariantCEditor =
  | { kind: "text"; inputType?: "text" | "email" }
  | { kind: "select"; options: readonly string[] }
  | { kind: "segmented"; options: readonly string[] }
  | { kind: "password" }
  | { kind: "keys" }
  | { kind: "members" }
  | { kind: "templateComponents" }
  | { kind: "linkOut"; href: string; linkLabel: string; body: string }
  | { kind: "checks" }
  | { kind: "organizations" }
  | { kind: "connectedApps" }
  | { kind: "apiKeys" }
  | { kind: "notApplicable"; body: string };

export interface VariantCSetting {
  id: string;
  /** Topic heading the row sits under. */
  group: string;
  label: string;
  value: string;
  scope: VariantCScope;
  changeBy: VariantCChangeBy;
  editor: VariantCEditor;
  /** Shown in "Needs attention" when set. Names the problem. */
  attention?: string;
  /** A Platform Admin who is not a member cannot use this here. */
  memberOnly?: boolean;
}

export interface VariantCOrg {
  id: string;
  name: string;
  facilities: readonly string[];
  /** Membership role by viewer. `null` = no membership (Platform Admin only). */
  roleFor: Record<VariantCViewer, "Owner" | "Admin" | "Member" | null>;
  lastOpened: Record<VariantCViewer, string | null>;
}

export const variantCFixtures = {
  people: {
    owner: { name: "Neema Mushi", email: "neema@mafinga-biochar.example" },
    member: { name: "Baraka Mollel", email: "baraka@mafinga-biochar.example" },
    platform: { name: "Jonas Keller", email: "jonas@noma.example" },
  },
  orgs: [
    {
      id: "mafinga",
      name: "Mafinga Biochar",
      facilities: ["Mafinga"],
      roleFor: { owner: "Owner", member: "Member", platform: null },
      lastOpened: { owner: "Today", member: "Today", platform: "14 Oct" },
    },
    {
      id: "kilombero",
      name: "Kilombero Carbon",
      facilities: ["Ifakara", "Mlimba"],
      roleFor: { owner: "Member", member: "Member", platform: null },
      lastOpened: { owner: "3 Oct", member: "29 Sep", platform: "2 Oct" },
    },
    {
      id: "ruvuma",
      name: "Ruvuma Char",
      facilities: ["Songea"],
      roleFor: { owner: null, member: null, platform: null },
      lastOpened: { owner: null, member: null, platform: null },
    },
  ] satisfies readonly VariantCOrg[],
  members: [
    { name: "Neema Mushi", role: "Owner" },
    { name: "Daudi Kimaro", role: "Admin" },
    { name: "Baraka Mollel", role: "Member" },
    { name: "Rehema Swai", role: "Member" },
    { name: "Elia Mrema", role: "Member" },
  ],
  pendingInvitation: "joseph@mafinga-biochar.example",
  templateComponents: [
    { name: "Grid electricity, pyrolysis stage", decided: false },
    { name: "Feedstock transport, round trip", decided: false },
    { name: "Staff travel", decided: false },
    { name: "Biochar transport to field", decided: true },
  ],
  diagnostics: [
    { check: "Isometric API reachable", result: "Passing" },
    { check: "Mafinga Biochar keys", result: "Not saved" },
    { check: "Kilombero Carbon keys", result: "Passing" },
    { check: "Webhook allowlist", result: "Passing" },
  ],
} as const;

export function variantCScopeLabel(scope: VariantCScope, facilityName: string): string {
  if (scope === "facility") return `Facility: ${facilityName}`;
  if (scope === "you") return "You";
  if (scope === "organization") return "Organization";
  return "Platform";
}

export const VARIANT_C_CHANGE_BY_LABEL: Record<VariantCChangeBy, string> = {
  you: "Only you",
  ownerAdmin: "Owners and Admins",
  allMembers: "All members",
  platformAdmin: "Platform Admins",
};

/** Every setting, in reading order. Groups appear in this order too. */
export function variantCSettings(
  viewer: VariantCViewer,
  orgName: string,
  facilityName: string,
): VariantCSetting[] {
  const person = variantCFixtures.people[viewer];
  return [
    // You
    { id: "name", group: "Your account", label: "Name", value: person.name, scope: "you", changeBy: "you", editor: { kind: "text" } },
    { id: "email", group: "Your account", label: "Email", value: person.email, scope: "you", changeBy: "you", editor: { kind: "text", inputType: "email" } },
    { id: "password", group: "Your account", label: "Password", value: "Changed 12 Aug 2026", scope: "you", changeBy: "you", editor: { kind: "password" } },
    { id: "connected-apps", group: "Your account", label: "Connected apps", value: viewer === "platform" ? "None" : "1 app: Claude", scope: "you", changeBy: "you", editor: { kind: "connectedApps" }, memberOnly: true },

    // Organization
    { id: "org-name", group: "Organization", label: "Organization name", value: orgName, scope: "organization", changeBy: "ownerAdmin", editor: { kind: "text" } },
    { id: "members", group: "Organization", label: "Members", value: "5 members, 1 invitation pending", scope: "organization", changeBy: "ownerAdmin", editor: { kind: "members" } },
    { id: "default-country", group: "Organization", label: "Default country", value: "Tanzania", scope: "organization", changeBy: "ownerAdmin", editor: { kind: "select", options: ["Tanzania", "Kenya", "Uganda"] } },
    { id: "default-timezone", group: "Organization", label: "Default timezone", value: "Africa/Dar_es_Salaam", scope: "organization", changeBy: "ownerAdmin", editor: { kind: "select", options: ["Africa/Dar_es_Salaam", "Africa/Nairobi", "UTC"] } },
    { id: "default-evidence", group: "Organization", label: "Application evidence", value: "Customer location", scope: "organization", changeBy: "ownerAdmin", editor: { kind: "segmented", options: ["Customer location", "GIS reference", "Visual evidence"] } },
    { id: "default-packaging", group: "Organization", label: "Order packaging", value: "Bagged", scope: "organization", changeBy: "ownerAdmin", editor: { kind: "segmented", options: ["Loose", "Bagged"] } },
    { id: "vehicles", group: "Organization", label: "Vehicles and crew", value: "3 vehicles, 6 crew", scope: "organization", changeBy: "allMembers", editor: { kind: "linkOut", href: "/settings/vehicles-and-crew", linkLabel: "Open vehicles and crew", body: "Vehicles and crew are a list you pick from on deliveries and production runs." } },

    // Registry
    { id: "isometric-keys", group: "Registry (Isometric)", label: "Isometric keys", value: "Not saved", scope: "organization", changeBy: "ownerAdmin", editor: { kind: "keys" }, attention: "Isometric keys not saved" },
    { id: "isometric-project", group: "Registry (Isometric)", label: "Isometric project", value: `prj_1K9YJ33R, ${orgName}`, scope: "organization", changeBy: "ownerAdmin", editor: { kind: "select", options: [`prj_1K9YJ33R, ${orgName}`, `prj_2B7QX0LM, ${orgName} pilot`] } },
    { id: "protocol", group: "Registry (Isometric)", label: "Protocol", value: "Biochar v1.1", scope: "organization", changeBy: "ownerAdmin", editor: { kind: "select", options: ["Biochar v1.1", "Biochar v1.0"] } },
    { id: "removal-template", group: "Registry (Isometric)", label: "Default Removal template", value: "Biochar Removal 2026, 3 components to decide", scope: "organization", changeBy: "ownerAdmin", editor: { kind: "templateComponents" }, attention: "3 template components to decide" },
    { id: "source-visibility", group: "Registry (Isometric)", label: "New Sources", value: "Private: verifier only", scope: "organization", changeBy: "ownerAdmin", editor: { kind: "segmented", options: ["Private: verifier only", "Public on the registry"] } },
    { id: "facility-link", group: "Registry (Isometric)", label: "Registry facility", value: `fcl_8QXT41, ${facilityName}`, scope: "facility", changeBy: "ownerAdmin", editor: { kind: "text" } },

    // Facility
    { id: "facility-name", group: "Facility", label: "Facility name", value: facilityName, scope: "facility", changeBy: "ownerAdmin", editor: { kind: "text" } },
    { id: "facility-country", group: "Facility", label: "Country", value: "Tanzania", scope: "facility", changeBy: "ownerAdmin", editor: { kind: "select", options: ["Tanzania", "Kenya", "Uganda"] } },
    { id: "facility-timezone", group: "Facility", label: "Timezone", value: "Africa/Dar_es_Salaam", scope: "facility", changeBy: "ownerAdmin", editor: { kind: "select", options: ["Africa/Dar_es_Salaam", "Africa/Nairobi", "UTC"] } },
    { id: "durability", group: "Facility", label: "Durability tier", value: "1000-year", scope: "facility", changeBy: "ownerAdmin", editor: { kind: "segmented", options: ["200-year", "1000-year"] } },
    { id: "soil-temperature", group: "Facility", label: "Reference soil temperature", value: "Not applicable", scope: "facility", changeBy: "ownerAdmin", editor: { kind: "notApplicable", body: `${facilityName} is on the 1000-year tier. Soil temperature only feeds the 200-year model.` } },

    // Developer access
    { id: "api-keys", group: "Developer access", label: "API keys", value: "2 keys", scope: "organization", changeBy: "ownerAdmin", editor: { kind: "apiKeys" }, memberOnly: true },
    { id: "api-access", group: "Developer access", label: "API access", value: "On", scope: "platform", changeBy: "platformAdmin", editor: { kind: "segmented", options: ["On", "Off"] } },

    // Platform
    { id: "organizations", group: "Platform", label: "Organizations", value: "3 organizations", scope: "platform", changeBy: "platformAdmin", editor: { kind: "organizations" } },
    { id: "diagnostics", group: "Platform", label: "Diagnostics", value: "1 check failing", scope: "platform", changeBy: "platformAdmin", editor: { kind: "checks" } },
  ];
}
