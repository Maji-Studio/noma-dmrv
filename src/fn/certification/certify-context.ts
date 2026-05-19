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
  aggregateTransportLegs,
  collectTransportEntityIds,
  listComponentBlueprints,
  listProjects,
  listRemovalTemplates,
  type IsometricComponentBlueprint,
  type IsometricProject,
  type IsometricRemovalTemplate,
} from "@/lib/isometric";
import { lookupInputMapping } from "@/lib/isometric/transformers/datapoint";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { ISOMETRIC_PROVIDER, safeListIfConfigured } from "./shared";

export interface TransportCoverageBucket {
  count: number;
  entityIds: string[];
  // Non-null when at least one leg in the category fails the per-leg
  // uniformity / completeness checks that `aggregateTransportLegs` enforces
  // (missing load_mass_kg, missing emission_factor_used, mixed methods,
  // mixed factors). The panel surfaces this so the user discovers the gap
  // BEFORE clicking submit, instead of after the server-side block.
  aggregationWarning: string | null;
}

export interface TransportCoverage {
  feedstock: TransportCoverageBucket;
  biochar: TransportCoverageBucket;
  sample: TransportCoverageBucket;
}

export type TransportCategory = keyof TransportCoverage;

const EMPTY_COVERAGE: TransportCoverage = {
  feedstock: { count: 0, entityIds: [], aggregationWarning: null },
  biochar: { count: 0, entityIds: [], aggregationWarning: null },
  sample: { count: 0, entityIds: [], aggregationWarning: null },
};

// Maps the INPUT_MAPPING.source field name that a monitored template input
// resolves to back to a transport category. Keep in sync with the three
// transport rows in `src/lib/isometric/transformers/datapoint.ts`.
const TRANSPORT_SOURCE_TO_CATEGORY: Record<string, TransportCategory> = {
  feedstockTransportAvgDistanceKm: "feedstock",
  biocharTransportAvgDistanceKm: "biochar",
  sampleTransportAvgDistanceKm: "sample",
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
  // Transport categories the active removal template actually consumes,
  // derived by walking `defaultTemplate.groups[*].components[*].inputs[*]`
  // and matching monitored inputs to INPUT_MAPPING transport rows. The
  // Certify panel only blocks coverage on these categories.
  requiredTransportCategories: TransportCategory[];
  isProduction: boolean;
}

function deriveRequiredTransportCategories(
  template: IsometricRemovalTemplate,
): TransportCategory[] {
  const seen = new Set<TransportCategory>();
  for (const group of template.groups) {
    for (const component of group.components) {
      for (const rtcInput of component.inputs) {
        if (rtcInput.type !== "monitored") continue;
        const mapping = lookupInputMapping(
          group.key,
          component.blueprint_key,
          rtcInput.input_key,
        );
        if (!mapping) continue;
        const category = TRANSPORT_SOURCE_TO_CATEGORY[mapping.source];
        if (category) seen.add(category);
      }
    }
  }
  // Stable ordering matches TransportCoverage key order.
  return (["feedstock", "biochar", "sample"] as const).filter((c) =>
    seen.has(c),
  );
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
      aggregationWarning: aggregateTransportLegs(feedstockLegs, "Feedstock")
        .warning,
    },
    biochar: {
      count: biocharLegs.length,
      entityIds: entityIds.biocharProductIds,
      aggregationWarning: aggregateTransportLegs(biocharLegs, "Biochar")
        .warning,
    },
    sample: {
      count: sampleLegs.length,
      entityIds: entityIds.sampleIds,
      aggregationWarning: aggregateTransportLegs(sampleLegs, "Sample").warning,
    },
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
      requiredTransportCategories: [],
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
      requiredTransportCategories: [],
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
      requiredTransportCategories: [],
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
  const requiredTransportCategories =
    deriveRequiredTransportCategories(defaultTemplate);

  return {
    facilityId,
    mapping,
    project,
    defaultTemplate,
    missingDefaultTemplateId: null,
    blueprintsForTemplate,
    unresolvedBlueprintKeys,
    transportCoverage,
    requiredTransportCategories,
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
