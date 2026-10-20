/**
 * Throwaway fixtures for settings prototype variant E (Platform as its own
 * workspace). Nothing here is read from or written to the database.
 */

export interface VariantEOrg {
  id: string;
  name: string;
  slug: string;
  members: number;
  apiAccess: boolean;
  keysSaved: boolean;
  lastOpened: string | null;
  facilities: readonly { name: string; registryFacilityId: string | null }[];
}

export const NOTHING_SAVED = "Prototype: nothing saved";

export const variantEFixtures = {
  platformAdmin: { name: "Jonas Keller", email: "jonas@noma.example" },
  owner: { name: "Neema Mushi", email: "neema@mafinga-biochar.example" },
  orgs: [
    {
      id: "mafinga",
      name: "Mafinga Biochar",
      slug: "mafinga-biochar",
      members: 5,
      apiAccess: true,
      keysSaved: false,
      lastOpened: "14 Oct",
      facilities: [{ name: "Mafinga", registryFacilityId: "fcl_8QXT41" }],
    },
    {
      id: "kilombero",
      name: "Kilombero Carbon",
      slug: "kilombero-carbon",
      members: 3,
      apiAccess: false,
      keysSaved: true,
      lastOpened: "2 Oct",
      facilities: [
        { name: "Ifakara", registryFacilityId: "fcl_2MDA90" },
        { name: "Mlimba", registryFacilityId: null },
      ],
    },
    {
      id: "ruvuma",
      name: "Ruvuma Char",
      slug: "ruvuma-char",
      members: 1,
      apiAccess: false,
      keysSaved: false,
      lastOpened: null,
      facilities: [{ name: "Songea", registryFacilityId: null }],
    },
  ] satisfies VariantEOrg[],
  members: [
    { name: "Neema Mushi", role: "Owner", lastActive: "Today" },
    { name: "Daudi Kimaro", role: "Admin", lastActive: "Yesterday" },
    { name: "Baraka Mollel", role: "Member", lastActive: "Today" },
    { name: "Rehema Swai", role: "Member", lastActive: "16 Oct" },
    { name: "Elia Mrema", role: "Member", lastActive: "11 Oct" },
  ],
  diagnostics: [
    { check: "Isometric API", detail: "Sandbox, reachable", ok: true },
    { check: "Mafinga Biochar keys", detail: "Not saved", ok: false },
    { check: "Kilombero Carbon keys", detail: "Saved, last used 18 Oct", ok: true },
    { check: "Ruvuma Char keys", detail: "Not saved", ok: false },
    { check: "Webhook allowlist", detail: "2 hosts", ok: true },
  ],
  templateMapping: [
    { component: "Biochar production, feedstock", source: "Production runs", decided: true },
    { component: "Grid electricity, pyrolysis stage", source: "Not decided", decided: false },
    { component: "Feedstock transport, round trip", source: "Not decided", decided: false },
    { component: "Biochar transport to field", source: "Deliveries", decided: true },
    { component: "Staff travel", source: "Not decided", decided: false },
  ],
  apiKeys: ["Production sync", "Lab import"],
};
