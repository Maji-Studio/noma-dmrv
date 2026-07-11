import { db, type DbTransaction } from ".";
import { feedstockTypes } from "./schema";

export const DEC_ORG_ID = "org_dark_earth_carbon";
export const DEC_ORG_NAME = "Dark Earth Carbon";
export const DEC_ORG_SLUG = "dark-earth-carbon";

export const STARTER_FEEDSTOCK_TYPES = [
  {
    code: "FT-26-001",
    name: "Mixed Hardwood Chips",
    category: "forestry",
    usage: "pyrolysis" as const,
    description:
      "Pruned branches and sawmill residues from local forestry operations",
  },
  {
    code: "FT-26-002",
    name: "Arabica Coffee Husk",
    category: "agricultural",
    usage: "pyrolysis" as const,
    description: "Coffee processing residue from wet mills",
  },
  {
    code: "FT-26-003",
    name: "Rice Husk",
    category: "agricultural",
    usage: "pyrolysis" as const,
    description: "Rice milling byproduct with high silica content",
  },
  {
    code: "FT-26-004",
    name: "Coconut Shell",
    category: "agricultural",
    usage: "pyrolysis" as const,
    description: "Coconut processing waste shells",
  },
  {
    code: "FT-26-005",
    name: "Cow Manure Compost",
    category: "compost",
    usage: "blend" as const,
    description: "Matured cow manure compost used as a blend material",
  },
  {
    code: "FT-26-006",
    name: "Green Waste Compost",
    category: "compost",
    usage: "blend" as const,
    description: "Screened green waste compost used as a blend material",
  },
  {
    code: "FT-26-007",
    name: "Rock Dust",
    category: "mineral",
    usage: "blend" as const,
    description: "Fine mineral amendment for premium blends",
  },
  {
    code: "FT-26-008",
    name: "Vermicompost",
    category: "compost",
    usage: "blend" as const,
    description: "Certified vermicompost for organic blends",
  },
  {
    code: "FT-26-009",
    name: "Agricultural Lime",
    category: "lime",
    usage: "blend" as const,
    description: "Agricultural lime used to adjust blend pH",
  },
] as const;

type OrgDefaultsExecutor = typeof db | DbTransaction;

/** Seed the starter catalog owned by a newly created organization. */
export async function seedOrgDefaults(
  txOrDb: OrgDefaultsExecutor,
  organizationId: string,
): Promise<void> {
  await txOrDb
    .insert(feedstockTypes)
    .values(
      STARTER_FEEDSTOCK_TYPES.map((feedstockType) => ({
        ...feedstockType,
        organizationId,
      })),
    )
    .onConflictDoNothing();
}
