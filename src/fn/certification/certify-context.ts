"use server";

import { env } from "@/config/env";
import {
  getCertifierProjectByFacility,
  type CertifierProjectRow,
} from "@/data-access/certification";
import { getChainOfCustodyData } from "@/data-access/chain-of-custody";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { SafeError } from "@/lib/errors";
import {
  collectTransportEntityIds,
  listComponentBlueprints,
  listProjects,
  listRemovalTemplates,
  type IsometricComponentBlueprint,
  type IsometricProject,
  type IsometricRemovalTemplate,
} from "@/lib/isometric";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { ISOMETRIC_PROVIDER, safeListIfConfigured } from "./shared";

export interface TransportCoverageBucket {
  count: number;
  entityIds: string[];
}

export interface TransportCoverage {
  feedstock: TransportCoverageBucket;
  biochar: TransportCoverageBucket;
  sample: TransportCoverageBucket;
}

const EMPTY_COVERAGE: TransportCoverage = {
  feedstock: { count: 0, entityIds: [] },
  biochar: { count: 0, entityIds: [] },
  sample: { count: 0, entityIds: [] },
};

export interface CertifyContextForCreditBatch {
  facilityId: string;
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  defaultTemplate: IsometricRemovalTemplate | null;
  missingDefaultTemplateId: string | null;
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  transportCoverage: TransportCoverage;
  isProduction: boolean;
}

async function loadTransportCoverage(
  userId: string,
  applicationIds: string[],
): Promise<TransportCoverage> {
  if (applicationIds.length === 0) return EMPTY_COVERAGE;

  const lineages = await Promise.all(
    applicationIds.map((id) => getChainOfCustodyData(userId, id)),
  );
  const productionRunIds = Array.from(
    new Set(
      lineages
        .map((l) => l.productionRun?.id)
        .filter((id): id is string => !!id),
    ),
  );
  const runs =
    productionRunIds.length > 0
      ? await getProductionRunsWithSamples(userId, productionRunIds)
      : [];

  const entityIds = collectTransportEntityIds(lineages, runs);
  const [feedstockLegs, biocharLegs, sampleLegs] = await Promise.all([
    getTransportLegsForEntities(userId, "feedstock", entityIds.feedstockIds),
    getTransportLegsForEntities(userId, "biochar", entityIds.biocharProductIds),
    getTransportLegsForEntities(userId, "sample", entityIds.sampleIds),
  ]);

  return {
    feedstock: {
      count: feedstockLegs.length,
      entityIds: entityIds.feedstockIds,
    },
    biochar: {
      count: biocharLegs.length,
      entityIds: entityIds.biocharProductIds,
    },
    sample: { count: sampleLegs.length, entityIds: entityIds.sampleIds },
  };
}

export async function loadCertifyContextForCreditBatchForUser(
  userId: string,
  creditBatchId: string,
): Promise<CertifyContextForCreditBatch> {
  const isProduction = env.ISOMETRIC_ENVIRONMENT === "production";

  const creditBatch = await getCreditBatchById(userId, creditBatchId);
  if (!creditBatch) {
    throw new SafeError("Credit batch not found");
  }

  const facilityId = creditBatch.facilityId;
  const mapping = await getCertifierProjectByFacility(
    userId,
    facilityId,
    ISOMETRIC_PROVIDER,
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
      transportCoverage: EMPTY_COVERAGE,
      isProduction,
    };
  }

  const [projects, templates] = await Promise.all([
    safeListIfConfigured(() => listProjects()),
    safeListIfConfigured(() => listRemovalTemplates(mapping.externalProjectId)),
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
      transportCoverage: EMPTY_COVERAGE,
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
      transportCoverage: EMPTY_COVERAGE,
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

  const allBlueprints = await safeListIfConfigured(() =>
    listComponentBlueprints(),
  );
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

  const transportCoverage = await loadTransportCoverage(
    userId,
    creditBatch.applicationIds,
  );

  return {
    facilityId,
    mapping,
    project,
    defaultTemplate,
    missingDefaultTemplateId: null,
    blueprintsForTemplate,
    unresolvedBlueprintKeys,
    transportCoverage,
    isProduction,
  };
}

export async function loadCertifyContextForCreditBatch(
  creditBatchId: string,
): Promise<ActionResult<CertifyContextForCreditBatch>> {
  return withAction(async (userId) =>
    loadCertifyContextForCreditBatchForUser(userId, creditBatchId),
  );
}
