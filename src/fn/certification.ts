"use server";

import { env } from "@/config/env";
import {
  deleteCertifierProject,
  getCertifierProjectByFacility,
  listFacilitiesLinkedToExternal,
  upsertCertifierProject,
  type CertifierProjectRow,
  type LinkedFacilitySummary,
} from "@/data-access/certification";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { SafeError } from "@/lib/errors";
import {
  listComponentBlueprints,
  listProjects,
  listRemovalTemplates,
  type IsometricComponentBlueprint,
  type IsometricProject,
  type IsometricRemovalTemplate,
} from "@/lib/isometric";
import {
  saveMappingSchema,
  type SaveMappingInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";

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
    const mapping = await getCertifierProjectByFacility(
      userId,
      facilityId,
      "isometric",
    );
    const availableProjects = await listProjects();
    const availableTemplates = mapping
      ? await listRemovalTemplates(mapping.externalProjectId)
      : [];
    const linkHints = await Promise.all(
      availableProjects.map(async (project) => ({
        externalProjectId: project.id,
        linkedFacilities: await listFacilitiesLinkedToExternal(
          userId,
          "isometric",
          project.id,
        ),
      })),
    );
    return {
      mapping,
      availableProjects,
      availableTemplates,
      linkHints,
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

    const projects = await listProjects();
    if (!projects.some((p) => p.id === parsed.externalProjectId)) {
      throw new SafeError(
        "Selected project does not exist on Isometric.",
      );
    }

    if (parsed.defaultRemovalTemplateId) {
      const templates = await listRemovalTemplates(parsed.externalProjectId);
      if (
        !templates.some((t) => t.id === parsed.defaultRemovalTemplateId)
      ) {
        throw new SafeError(
          "Selected template does not belong to the chosen project.",
        );
      }
    }

    return upsertCertifierProject(userId, {
      facilityId: parsed.facilityId,
      provider: "isometric",
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
    await deleteCertifierProject(userId, facilityId, "isometric");
  });
}

export async function loadIsometricProjectTemplates(
  externalProjectId: string,
): Promise<ActionResult<IsometricRemovalTemplate[]>> {
  return withAction(async () => {
    return listRemovalTemplates(externalProjectId);
  });
}

export interface CertifyContextForCreditBatch {
  facilityId: string;
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  defaultTemplate: IsometricRemovalTemplate | null;
  missingDefaultTemplateId: string | null;
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  isProduction: boolean;
}

export async function loadCertifyContextForCreditBatch(
  creditBatchId: string,
): Promise<ActionResult<CertifyContextForCreditBatch>> {
  return withAction(async (userId) => {
    const isProduction = env.ISOMETRIC_ENVIRONMENT === "production";

    const creditBatch = await getCreditBatchById(userId, creditBatchId);
    if (!creditBatch) {
      throw new SafeError("Credit batch not found");
    }

    const facilityId = creditBatch.facilityId;
    const mapping = await getCertifierProjectByFacility(
      userId,
      facilityId,
      "isometric",
    );

    if (!mapping) {
      return {
        facilityId,
        mapping: null,
        project: null,
        defaultTemplate: null,
        missingDefaultTemplateId: null,
        blueprintsForTemplate: [],
        unresolvedBlueprintKeys: [],
        isProduction,
      };
    }

    const [projects, templates] = await Promise.all([
      listProjects(),
      listRemovalTemplates(mapping.externalProjectId),
    ]);

    const project =
      projects.find((p) => p.id === mapping.externalProjectId) ?? null;

    if (!mapping.defaultRemovalTemplateId) {
      return {
        facilityId,
        mapping,
        project,
        defaultTemplate: null,
        missingDefaultTemplateId: null,
        blueprintsForTemplate: [],
        unresolvedBlueprintKeys: [],
        isProduction,
      };
    }

    const defaultTemplate =
      templates.find((t) => t.id === mapping.defaultRemovalTemplateId) ?? null;

    if (!defaultTemplate) {
      return {
        facilityId,
        mapping,
        project,
        defaultTemplate: null,
        missingDefaultTemplateId: mapping.defaultRemovalTemplateId,
        blueprintsForTemplate: [],
        unresolvedBlueprintKeys: [],
        isProduction,
      };
    }

    const referencedKeys = Array.from(
      new Set(
        defaultTemplate.groups.flatMap((group) =>
          group.components.map((component) => component.blueprint_key),
        ),
      ),
    );

    const allBlueprints = await listComponentBlueprints();
    const blueprintByKey = new Map(allBlueprints.map((bp) => [bp.key, bp]));

    const blueprintsForTemplate: IsometricComponentBlueprint[] = [];
    const unresolvedBlueprintKeys: string[] = [];
    for (const key of referencedKeys) {
      const found = blueprintByKey.get(key);
      if (found) {
        blueprintsForTemplate.push(found);
      } else {
        unresolvedBlueprintKeys.push(key);
      }
    }

    return {
      facilityId,
      mapping,
      project,
      defaultTemplate,
      missingDefaultTemplateId: null,
      blueprintsForTemplate,
      unresolvedBlueprintKeys,
      isProduction,
    };
  });
}
