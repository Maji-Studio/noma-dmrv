"use server";

import { env } from "@/config/env";
import {
  deleteCertifierProject,
  getCertifierProjectByFacility,
  listAllFacilitiesLinkedByProvider,
  upsertCertifierProject,
  type CertifierProjectRow,
  type LinkedFacilitySummary,
} from "@/data-access/certification";
import { SafeError } from "@/lib/errors";
import {
  listProjects,
  listRemovalTemplates,
  type IsometricProject,
  type IsometricRemovalTemplate,
} from "@/lib/isometric";
import {
  saveMappingSchema,
  type SaveMappingInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { ISOMETRIC_PROVIDER, safeListIfConfigured } from "./shared";

export interface FacilityCertifierMapping {
  mapping: CertifierProjectRow | null;
  availableProjects: IsometricProject[];
  availableTemplates: IsometricRemovalTemplate[];
  linkHints: Array<{
    externalProjectId: string;
    linkedFacilities: LinkedFacilitySummary[];
  }>;
  isProduction: boolean;
}

export async function loadFacilityCertifierMapping(
  facilityId: string,
): Promise<ActionResult<FacilityCertifierMapping>> {
  return withAction(async (userId) => {
    const [mapping, availableProjects, allLinkedFacilities] = await Promise.all([
      getCertifierProjectByFacility(userId, facilityId, ISOMETRIC_PROVIDER),
      safeListIfConfigured(() => listProjects()),
      listAllFacilitiesLinkedByProvider(userId, ISOMETRIC_PROVIDER),
    ]);

    const availableTemplates = mapping
      ? await safeListIfConfigured(() =>
          listRemovalTemplates(mapping.externalProjectId),
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
    };
  });
}

export async function saveFacilityCertifierMapping(
  input: SaveMappingInput,
): Promise<ActionResult<CertifierProjectRow>> {
  return withAction(async (userId) => {
    const parsed = saveMappingSchema.parse(input);

    if (
      env.ISOMETRIC_ENVIRONMENT === "production" &&
      !parsed.confirmProduction
    ) {
      throw new SafeError(
        "Confirm you want to save against the production Isometric environment.",
      );
    }

    const [projects, templates] = await Promise.all([
      listProjects(),
      parsed.defaultRemovalTemplateId
        ? listRemovalTemplates(parsed.externalProjectId)
        : Promise.resolve(null),
    ]);
    if (!projects.some((p) => p.id === parsed.externalProjectId)) {
      throw new SafeError("Selected project does not exist on Isometric.");
    }
    if (
      templates &&
      !templates.some((t) => t.id === parsed.defaultRemovalTemplateId)
    ) {
      throw new SafeError(
        "Selected template does not belong to the chosen project.",
      );
    }

    return upsertCertifierProject(userId, {
      facilityId: parsed.facilityId,
      provider: ISOMETRIC_PROVIDER,
      externalProjectId: parsed.externalProjectId,
      protocolSlug: parsed.protocolSlug,
      protocolVersion: parsed.protocolVersion ?? null,
      defaultRemovalTemplateId: parsed.defaultRemovalTemplateId ?? null,
    });
  });
}

export async function deleteFacilityCertifierMapping(
  facilityId: string,
): Promise<ActionResult<void>> {
  return withAction(async (userId) => {
    await deleteCertifierProject(userId, facilityId, ISOMETRIC_PROVIDER);
  });
}

export async function loadIsometricProjectTemplates(
  externalProjectId: string,
): Promise<ActionResult<IsometricRemovalTemplate[]>> {
  return withAction(async () => {
    return listRemovalTemplates(externalProjectId);
  });
}
