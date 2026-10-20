/**
 * Throwaway fixtures for settings prototype variants A, B and D. Every figure
 * here is invented for the prototype and never reaches the database.
 */

export type OrgRole = "Owner" | "Admin" | "Member";

/** Who is looking: an Owner of Mafinga Biochar, or a Platform Admin who entered it. */
export type PrototypeViewer = "member" | "platform-admin";

export const VIEWER_PARAM = "as";

export function viewerFromParam(value: string | null): PrototypeViewer {
  return value === "platform-admin" ? "platform-admin" : "member";
}

export const PROTOTYPE_SAVE_TOAST = "Prototype: nothing saved";

export const fixtures = {
  memberUser: {
    name: "Neema Mushi",
    email: "neema@mafinga-biochar.example",
  },
  platformAdminUser: {
    name: "Jonas Keller",
    email: "jonas@noma.example",
  },
  /** Orgs the member user belongs to, with her role in each. */
  memberships: [
    { id: "org-mafinga", name: "Mafinga Biochar", role: "Owner" as OrgRole, lastOpened: "Today" },
    { id: "org-kilombero", name: "Kilombero Carbon", role: "Member" as OrgRole, lastOpened: "12 Oct 2026" },
  ],
  /** Every org on the platform, as a Platform Admin sees them. */
  organizations: [
    {
      id: "org-mafinga",
      name: "Mafinga Biochar",
      slug: "mafinga-biochar",
      members: 4,
      apiAccess: true,
      keysSaved: true,
      lastOpened: "Today",
    },
    {
      id: "org-kilombero",
      name: "Kilombero Carbon",
      slug: "kilombero-carbon",
      members: 2,
      apiAccess: false,
      keysSaved: false,
      lastOpened: "12 Oct 2026",
    },
    {
      id: "org-usangu",
      name: "Usangu Char Works",
      slug: "usangu-char",
      members: 3,
      apiAccess: false,
      keysSaved: true,
      lastOpened: "Never",
    },
  ],
  activeOrg: {
    id: "org-mafinga",
    name: "Mafinga Biochar",
    slug: "mafinga-biochar",
  },
  members: [
    { id: "m1", name: "Neema Mushi", email: "neema@mafinga-biochar.example", role: "Owner" as OrgRole },
    { id: "m2", name: "Baraka Ally", email: "baraka@mafinga-biochar.example", role: "Admin" as OrgRole },
    { id: "m3", name: "Rehema Said", email: "rehema@mafinga-biochar.example", role: "Member" as OrgRole },
    { id: "m4", name: "Joseph Mrema", email: "joseph@mafinga-biochar.example", role: "Member" as OrgRole },
  ],
  invitations: [
    { id: "i1", email: "amina@mafinga-biochar.example", role: "Member" as OrgRole, sent: "18 Oct 2026" },
  ],
  orgDefaults: {
    country: "Tanzania",
    timezone: "Africa/Dar_es_Salaam",
    evidenceMethod: "Customer location",
    packaging: "Bagged",
  },
  registry: {
    name: "Isometric",
    environment: "Sandbox",
    keysSaved: true,
    keyHint: "ends in 7Q2F",
    project: "prj_1K9YJ33RKSBX9FFF",
    protocol: "Biochar Production and Storage v1.1",
    sourceVisibility: "Private: verifier only",
    defaultRemovalTemplate: "Biochar in agricultural soils",
    componentsToDecide: 3,
  },
  facilities: [
    {
      id: "fac-mafinga",
      name: "Mafinga",
      country: "Tanzania",
      timezone: "Africa/Dar_es_Salaam",
      durabilityTier: "1000-year",
      registryFacility: "fcl_1K9YJ4M2TZ8QWERT",
      soilTemperature: "Not applicable",
      removalTemplate: null as string | null,
      emissions: "Not used on the 1000-year tier",
    },
    {
      id: "fac-ihemi",
      name: "Ihemi",
      country: "Tanzania",
      timezone: "Africa/Dar_es_Salaam",
      durabilityTier: "200-year",
      registryFacility: null as string | null,
      soilTemperature: "21.4 °C",
      removalTemplate: "Biochar in agricultural soils (200-year)" as string | null,
      emissions: "2 emission estimates",
    },
  ],
  apiKeys: [
    { id: "k1", name: "Cowork import", owner: "Neema Mushi", created: "3 Oct 2026", lastUsed: "Today" },
  ],
  connectedApps: [
    { id: "c1", name: "Claude", org: "Mafinga Biochar", connected: "12 Oct 2026", permissions: "Read and record production data" },
  ],
  vehiclesAndCrew: { vehicles: 6, drivers: 4 },
  diagnostics: { lastSync: "Today 09:41", failedSubmissions: 0 },
} as const;

export type PrototypeFacility = (typeof fixtures.facilities)[number];
