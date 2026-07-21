"use server";

import { env } from "@/config/env";
import {
  deleteCertifierProject,
  getCertifierProjectByFacility,
  listAllFacilitiesLinkedByProvider,
  updateFacilityEmissionConfig,
  upsertCertifierProject,
  type CertifierProjectRow,
  type LinkedFacilitySummary,
} from "@/data-access/certification";
import { requireOrgFacility } from "@/data-access/utils";
import { requireOrgRole } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import {
  getIsometricClientForOrg,
  IsometricApiError,
  listProjects,
  listGhgEntryTemplates,
  type IsometricProject,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import {
  facilityEmissionConfigSchema,
  saveMappingSchema,
  type FacilityEmissionConfigFormData,
  type SaveMappingInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { ISOMETRIC_PROVIDER, safeListIfConfigured } from "./shared";

export interface FacilityCertifierMapping {
  mapping: CertifierProjectRow | null;
  availableProjects: IsometricProject[];
  availableTemplates: IsometricGhgEntryTemplate[];
  linkHints: Array<{
    externalProjectId: string;
    linkedFacilities: LinkedFacilitySummary[];
  }>;
  isProduction: boolean;
  // Whether Isometric API credentials are present. Lets the UI distinguish
  // "Isometric isn't configured" (availableProjects forced empty by
  // safeListIfConfigured) from a configured account with no projects.
  isConfigured: boolean;
}

// Read-only registry-link summary for non-managing viewers. DB-only — it
// deliberately does NOT hit the Isometric API (`listProjects` /
// `listGhgEntryTemplates`) or the cross-facility link query that
// `loadFacilityCertifierMapping` does. A non-admin reading the current mapping
// must not pull the management payload (available project list, link hints,
// template options). The trade-off: the read-only view shows the persisted
// identifiers on the row, not the human-friendly project/template names
// (those are only resolvable from the management list).
export interface FacilityCertifierSummary {
  mapping: CertifierProjectRow | null;
  isProduction: boolean;
  viewerCanManage: boolean;
}

export async function loadFacilityCertifierSummary(
  facilityId: string,
): Promise<ActionResult<FacilityCertifierSummary>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const mapping = await getCertifierProjectByFacility(
      orgCtx,
      facilityId,
      ISOMETRIC_PROVIDER,
    );
    return {
      mapping,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
      viewerCanManage:
        orgCtx.isPlatformAdmin ||
        orgCtx.orgRole === "owner" ||
        orgCtx.orgRole === "admin",
    };
  });
}

export async function loadFacilityCertifierMapping(
  facilityId: string,
): Promise<ActionResult<FacilityCertifierMapping>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    const [mapping, projectCatalog, allLinkedFacilities] = await Promise.all([
      getCertifierProjectByFacility(orgCtx, facilityId, ISOMETRIC_PROVIDER),
      listProjectsWithConfiguration(client),
      listAllFacilitiesLinkedByProvider(orgCtx, ISOMETRIC_PROVIDER),
    ]);
    const availableProjects = projectCatalog.projects;

    const availableTemplates = mapping
      ? await safeListIfConfigured(() =>
          listGhgEntryTemplates(client, mapping.externalProjectId),
        )
      : [];

    const hintsByProject = new Map<string, LinkedFacilitySummary[]>();
    for (const row of allLinkedFacilities) {
      const bucket = hintsByProject.get(row.externalProjectId) ?? [];
      bucket.push({ facilityId: row.facilityId, code: row.code, name: row.name });
      hintsByProject.set(row.externalProjectId, bucket);
    }

    return {
      mapping,
      availableProjects,
      availableTemplates,
      linkHints: availableProjects.map((project) => ({
        externalProjectId: project.id,
        linkedFacilities: hintsByProject.get(project.id) ?? [],
      })),
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
      isConfigured: projectCatalog.isConfigured,
    };
  });
}

async function listProjectsWithConfiguration(
  client: import("@/lib/isometric").IsometricClient,
): Promise<{ projects: IsometricProject[]; isConfigured: boolean }> {
  try {
    return { projects: await listProjects(client), isConfigured: true };
  } catch (err) {
    if (err instanceof IsometricApiError && err.code === "not_configured") {
      return { projects: [], isConfigured: false };
    }
    throw err;
  }
}

// Org Owner/Admin-only: this action rewires which Isometric project every
// future Removal / GHG-statement submission for the facility targets.
// Platform admins also pass through requireOrgRole.
export async function saveFacilityCertifierMapping(
  input: SaveMappingInput,
): Promise<ActionResult<CertifierProjectRow>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsed = saveMappingSchema.parse(input);
    // certifier_projects.facilityId has no FK to facilities(id), so an org
    // admin could otherwise insert a row pairing their organizationId with a
    // foreign facility UUID (cross-org squatting on externalFacilityId).
    await requireOrgFacility(orgCtx, parsed.facilityId);

    if (
      env.ISOMETRIC_ENVIRONMENT === "production" &&
      !parsed.confirmProduction
    ) {
      throw new SafeError(
        "Confirm you want to save against the production Isometric environment.",
      );
    }

    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    let projects;
    try {
      projects = await listProjects(client);
    } catch (error) {
      if (error instanceof IsometricApiError && error.code === "not_configured") {
        throw new SafeError(
          "Configure this organization's Isometric credentials before mapping a facility.",
        );
      }
      throw error;
    }
    if (!projects.some((p) => p.id === parsed.externalProjectId)) {
      throw new SafeError("Selected project does not exist on Isometric.");
    }
    if (parsed.defaultRemovalTemplateId) {
      const templates = await listGhgEntryTemplates(client, parsed.externalProjectId);
      const selectedTemplate = templates.find(
        (t) => t.id === parsed.defaultRemovalTemplateId,
      );
      if (!selectedTemplate) {
        throw new SafeError(
          "Selected template does not belong to the chosen project.",
        );
      }
      // We only submit biochar REMOVAL credits; a REDUCTION template bound
      // here would mislabel every future GHG entry created from it.
      if (selectedTemplate.credit_type !== "REMOVAL") {
        throw new SafeError(
          "Selected template is not a REMOVAL template. Only REMOVAL templates can be used for biochar submissions.",
        );
      }
    }

    return upsertCertifierProject(orgCtx, {
      facilityId: parsed.facilityId,
      provider: ISOMETRIC_PROVIDER,
      externalProjectId: parsed.externalProjectId,
      protocolSlug: parsed.protocolSlug,
      defaultRemovalTemplateId: parsed.defaultRemovalTemplateId ?? null,
      externalFacilityId: parsed.externalFacilityId ?? null,
    });
  });
}

// Org Owner/Admin-only: unlinking strands every in-flight submission's audit
// trail against an external project the operator can no longer reach.
export async function deleteFacilityCertifierMapping(
  facilityId: string,
): Promise<ActionResult<void>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    await deleteCertifierProject(orgCtx, facilityId, ISOMETRIC_PROVIDER);
  });
}

export async function loadIsometricProjectTemplates(
  externalProjectId: string,
): Promise<ActionResult<IsometricGhgEntryTemplate[]>> {
  return withAction(async (orgCtx) => {
    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    return listGhgEntryTemplates(client, externalProjectId);
  });
}

// Org Owner/Admin-only: this per-facility emission-estimate config feeds the
// reference soil temperature submitted with every 200-year removal (the
// genset yield is a vestigial local estimate since issue #319).
export async function saveFacilityEmissionConfig(
  input: FacilityEmissionConfigFormData,
): Promise<ActionResult<CertifierProjectRow>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsed = facilityEmissionConfigSchema.parse(input);
    return updateFacilityEmissionConfig(orgCtx, {
      facilityId: parsed.facilityId,
      provider: ISOMETRIC_PROVIDER,
      gensetEnergyYieldKwhPerLitre: parsed.gensetEnergyYieldKwhPerLitre ?? null,
      defaultSoilTemperatureC: parsed.defaultSoilTemperatureC ?? null,
      defaultSoilTemperatureSource: parsed.defaultSoilTemperatureSource ?? null,
    });
  });
}
