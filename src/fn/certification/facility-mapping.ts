"use server";

import { resolveIsometricClient } from "@/data-access/certifier-credentials";
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
  IsometricApiError,
  listProjects,
  listGhgEntryTemplates,
  type IsometricProject,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import { assertSequestrationTemplateSelectable } from "@/lib/isometric/transformers/sequestration-binding";
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

export async function loadFacilityCertifierMapping(
  facilityId: string,
): Promise<ActionResult<FacilityCertifierMapping>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const client = await resolveIsometricClient(orgCtx);
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
    // Check facility ownership before registry reads. The composite FK and
    // upsert organization guard also enforce it at the persistence boundary.
    await requireOrgFacility(orgCtx, parsed.facilityId);

    if (
      env.ISOMETRIC_ENVIRONMENT === "production" &&
      !parsed.confirmProduction
    ) {
      throw new SafeError(
        "Confirm you want to save against the production Isometric environment.",
      );
    }

    const client = await resolveIsometricClient(orgCtx);
    let projects;
    try {
      projects = await listProjects(client);
    } catch (error) {
      if (error instanceof IsometricApiError && error.code === "not_configured") {
        throw new SafeError(
          "Configure this Organization's Isometric credentials before mapping a facility.",
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
      assertSequestrationTemplateSelectable(selectedTemplate);
    }

    return upsertCertifierProject(orgCtx, {
      facilityId: parsed.facilityId,
      provider: ISOMETRIC_PROVIDER,
      externalProjectId: parsed.externalProjectId,
      protocolSlug: parsed.protocolSlug,
      defaultRemovalTemplateId: parsed.defaultRemovalTemplateId ?? null,
      externalFacilityId: parsed.externalFacilityId,
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
    const client = await resolveIsometricClient(orgCtx);
    return listGhgEntryTemplates(client, externalProjectId);
  });
}

// Org Owner/Admin-only: this per-facility emission-estimate config feeds the
// reference soil temperature submitted with every 200-year removal.
export async function saveFacilityEmissionConfig(
  input: FacilityEmissionConfigFormData,
): Promise<ActionResult<CertifierProjectRow>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsed = facilityEmissionConfigSchema.parse(input);
    return updateFacilityEmissionConfig(orgCtx, {
      facilityId: parsed.facilityId,
      provider: ISOMETRIC_PROVIDER,
      defaultSoilTemperatureC: parsed.defaultSoilTemperatureC ?? null,
      defaultSoilTemperatureSource: parsed.defaultSoilTemperatureSource ?? null,
    });
  });
}
