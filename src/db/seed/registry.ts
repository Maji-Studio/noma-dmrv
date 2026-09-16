import { DEFAULT_PROTOCOL_SLUG } from "@/config/certification";
import { setOrgCertifierCredentialsFn } from "@/fn/certifier-credentials";
import {
  loadFacilityCertifierMapping,
  saveFacilityCertifierMapping,
} from "@/fn/certification/facility-mapping";
import { loadIsometricFeedstockTypes } from "@/fn/certification/feedstock-types";
import { createFeedstockTypeFn, importIsometricFeedstockTypeFn } from "@/fn/feedstock-types";
import { selectForestryEntry } from "./forestry-catalogue";
import { DEC_ORG_ID } from "../org-defaults";
import { FORESTRY, MANURE } from "./constants";
import { SeedError, unwrap, type SeedCounts } from "./actions";

const FACILITY_ID_PREFIX = "fcl_";
export const PROJECT_ID_ENV = "ISOMETRIC_DEMO_PROJECT_ID";
export const FACILITY_ID_ENV = "ISOMETRIC_DEMO_FACILITY_ID";

export type RegistryEnvironment = {
  accessToken: string;
  clientSecret: string;
  /** Optional: pins the project when the credentials can see more than one. */
  externalProjectId: string | null;
  /** Optional: the mapping form requires it, so without it mapping is skipped. */
  externalFacilityId: string | null;
};

export function registryEnvironment(): RegistryEnvironment | null {
  const accessToken = process.env.ISOMETRIC_ACCESS_TOKEN;
  const clientSecret = process.env.ISOMETRIC_CLIENT_SECRET;
  if (!accessToken || !clientSecret) return null;
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
    throw new SeedError("registry preflight: CREDENTIALS_ENCRYPTION_KEY is required to encrypt credentials");
  }
  const externalFacilityId = process.env[FACILITY_ID_ENV]?.trim() || null;
  // The Certify REST API has no facilities endpoint, so the fcl_ ID can only be
  // copied from the Certify UI. Never invent one or create a remote facility.
  if (externalFacilityId && !externalFacilityId.startsWith(FACILITY_ID_PREFIX)) {
    throw new SeedError(`registry preflight: ${FACILITY_ID_ENV} must start with ${FACILITY_ID_PREFIX}`);
  }
  return {
    accessToken,
    clientSecret,
    externalProjectId: process.env[PROJECT_ID_ENV]?.trim() || null,
    externalFacilityId,
  };
}

/** Same project list the Certification Settings dialog shows the operator. */
async function resolveProjectId(facilityId: string, pinned: string | null): Promise<string> {
  const mapping = await unwrap("list registry projects", loadFacilityCertifierMapping(facilityId));
  // The demo dataset is fabricated. Never let it reach a production registry
  // project, and never confirm that prompt on the operator's behalf.
  if (mapping.isProduction) {
    throw new SeedError("registry project: the demo seed never maps a facility to a production Isometric registry. Point ISOMETRIC_ENVIRONMENT at the sandbox.");
  }
  const projects = mapping.availableProjects;
  if (pinned) {
    if (!projects.some((project) => project.id === pinned)) {
      throw new SeedError(`registry project: ${PROJECT_ID_ENV}=${pinned} is not visible to these credentials`);
    }
    return pinned;
  }
  if (projects.length === 1) return projects[0].id;
  const names = projects.map((project) => `${project.id} (${project.name})`).join(", ");
  throw new SeedError(
    projects.length === 0
      ? "registry project: these credentials can see no projects"
      : `registry project: set ${PROJECT_ID_ENV} to one of ${names}`,
  );
}

async function createLocalTypes(counts: SeedCounts) {
  const forestry = await unwrap("create local forestry feedstock type", createFeedstockTypeFn(FORESTRY));
  console.log("Registry feedstock fallback: local pyrolysis forestry type created.");
  const manure = await unwrap("create chicken manure blend type", createFeedstockTypeFn(MANURE));
  counts.add("feedstock types", 2);
  return { forestry, manure };
}

export async function seedRegistryAndTypes(facilityId: string, counts: SeedCounts) {
  const credentials = registryEnvironment();
  if (!credentials) {
    console.warn("Registry credentials unavailable: skipping credentials and facility mapping.");
    return { ...(await createLocalTypes(counts)), registryStatus: "skipped (no credentials)" };
  }

  const saved = await unwrap("save registry credentials", setOrgCertifierCredentialsFn({
    organizationId: DEC_ORG_ID, accessToken: credentials.accessToken, clientSecret: credentials.clientSecret,
  }));
  if (!saved.verification.ok) throw new SeedError(`verify registry credentials: ${saved.verification.message}`);
  counts.add("registry credentials");

  const externalProjectId = await resolveProjectId(facilityId, credentials.externalProjectId);
  let registryStatus: string;
  if (credentials.externalFacilityId) {
    // Empty template is the UI default. Linking a project does not submit anything.
    await unwrap("link registry project", saveFacilityCertifierMapping({
      facilityId, externalProjectId, protocolSlug: DEFAULT_PROTOCOL_SLUG,
      externalFacilityId: credentials.externalFacilityId, defaultRemovalTemplateId: "", confirmProduction: false,
    }));
    counts.add("registry mappings");
    registryStatus = `credentials stored + facility mapped to ${externalProjectId}`;
  } else {
    console.warn(`Registry facility ID missing: set ${FACILITY_ID_ENV} (fcl_ ID from Certify) to map the facility, or map it in Certification Settings.`);
    registryStatus = `credentials stored; facility mapping skipped (project ${externalProjectId}, no ${FACILITY_ID_ENV})`;
  }

  const catalogue = await unwrap("read registry feedstock catalogue", loadIsometricFeedstockTypes());
  const entry = selectForestryEntry(catalogue);
  const forestry = await unwrap("import forestry feedstock type", importIsometricFeedstockTypeFn({
    isometricFeedstockTypeId: entry.id, category: FORESTRY.category,
  }));
  const manure = await unwrap("create chicken manure blend type", createFeedstockTypeFn(MANURE));
  counts.add("feedstock types", 2);
  return { forestry, manure, registryStatus };
}
