"use server";

import { env } from "@/config/env";
import {
  getCertifierProjectByFacility,
  type CertifierProjectRow,
} from "@/data-access/certification";
import {
  getChainOfCustodyData,
  type ChainOfCustodyData,
} from "@/data-access/chain-of-custody";
import {
  getCreditBatchById,
  type CreditBatchWithRelations,
} from "@/data-access/credit-batches";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
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
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  ISOMETRIC_PROVIDER,
  loadTransportLegsByCategory,
  safeListIfConfigured,
  type TransportLegsByCategory,
} from "./shared";

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

// Extends the UI-facing context with the raw chain data needed by the submit
// pipeline. Kept server-internal so the React Query-cached UI payload stays
// lean (lineages/runs/legs are heavy).
export interface SubmissionContext extends CertifyContextForCreditBatch {
  creditBatch: CreditBatchWithRelations;
  lineages: ChainOfCustodyData[];
  runs: ProductionRunWithSamples[];
  transportLegs: TransportLegsByCategory;
}

function buildCoverage(
  legs: TransportLegsByCategory,
  entityIds: ReturnType<typeof collectTransportEntityIds>,
): TransportCoverage {
  return {
    feedstock: {
      count: legs.feedstock.length,
      entityIds: entityIds.feedstockIds,
      aggregationWarning: aggregateTransportLegs(legs.feedstock, "Feedstock")
        .warning,
    },
    biochar: {
      count: legs.biochar.length,
      entityIds: entityIds.biocharProductIds,
      aggregationWarning: aggregateTransportLegs(legs.biochar, "Biochar")
        .warning,
    },
    sample: {
      count: legs.sample.length,
      entityIds: entityIds.sampleIds,
      aggregationWarning: aggregateTransportLegs(legs.sample, "Sample").warning,
    },
  };
}

export async function loadSubmissionContext(
  userId: string,
  creditBatchId: string,
): Promise<SubmissionContext> {
  const isProduction = env.ISOMETRIC_ENVIRONMENT === "production";

  const creditBatch = await getCreditBatchById(userId, creditBatchId);
  if (!creditBatch) {
    throw new SafeError("Credit batch not found");
  }

  const facilityId = creditBatch.facilityId;
  const emptyLegs: TransportLegsByCategory = {
    feedstock: [],
    biochar: [],
    sample: [],
  };
  const baseEmpty = {
    facilityId,
    creditBatch,
    lineages: [] as ChainOfCustodyData[],
    runs: [] as ProductionRunWithSamples[],
    transportLegs: emptyLegs,
    transportCoverage: EMPTY_COVERAGE,
    requiredTransportCategories: [] as TransportCategory[],
    isProduction,
  };

  const mapping = await getCertifierProjectByFacility(
    userId,
    facilityId,
    ISOMETRIC_PROVIDER,
  );

  if (!mapping) {
    return {
      ...baseEmpty,
      mapping: null,
      project: null,
      defaultTemplate: null,
      missingDefaultTemplateId: null,
      blueprintsForTemplate: [],
      unresolvedBlueprintKeys: [],
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
      ...baseEmpty,
      mapping,
      project,
      defaultTemplate: null,
      missingDefaultTemplateId: null,
      blueprintsForTemplate: [],
      unresolvedBlueprintKeys: [],
    };
  }

  const defaultTemplate =
    templates.find((t) => t.id === mapping.defaultRemovalTemplateId) ?? null;

  if (!defaultTemplate) {
    return {
      ...baseEmpty,
      mapping,
      project,
      defaultTemplate: null,
      missingDefaultTemplateId: mapping.defaultRemovalTemplateId,
      blueprintsForTemplate: [],
      unresolvedBlueprintKeys: [],
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

  const requiredTransportCategories =
    deriveRequiredTransportCategories(defaultTemplate);

  if (creditBatch.applicationIds.length === 0) {
    return {
      ...baseEmpty,
      mapping,
      project,
      defaultTemplate,
      missingDefaultTemplateId: null,
      blueprintsForTemplate,
      unresolvedBlueprintKeys,
      requiredTransportCategories,
    };
  }

  const lineages = await Promise.all(
    creditBatch.applicationIds.map((id) =>
      getChainOfCustodyData(userId, id),
    ),
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
  const transportLegs = await loadTransportLegsByCategory(userId, entityIds);
  const transportCoverage = buildCoverage(transportLegs, entityIds);

  return {
    facilityId,
    creditBatch,
    mapping,
    project,
    defaultTemplate,
    missingDefaultTemplateId: null,
    blueprintsForTemplate,
    unresolvedBlueprintKeys,
    lineages,
    runs,
    transportLegs,
    transportCoverage,
    requiredTransportCategories,
    isProduction,
  };
}

// Strip heavy raw fields (lineages, runs, legs) — only the UI summary
// crosses the network to React Query.
function projectUiContext(
  ctx: SubmissionContext,
): CertifyContextForCreditBatch {
  return {
    facilityId: ctx.facilityId,
    mapping: ctx.mapping,
    project: ctx.project,
    defaultTemplate: ctx.defaultTemplate,
    missingDefaultTemplateId: ctx.missingDefaultTemplateId,
    blueprintsForTemplate: ctx.blueprintsForTemplate,
    unresolvedBlueprintKeys: ctx.unresolvedBlueprintKeys,
    transportCoverage: ctx.transportCoverage,
    requiredTransportCategories: ctx.requiredTransportCategories,
    isProduction: ctx.isProduction,
  };
}

export async function loadCertifyContextForCreditBatchForUser(
  userId: string,
  creditBatchId: string,
): Promise<CertifyContextForCreditBatch> {
  return projectUiContext(await loadSubmissionContext(userId, creditBatchId));
}

export async function loadCertifyContextForCreditBatch(
  creditBatchId: string,
): Promise<ActionResult<CertifyContextForCreditBatch>> {
  return withAction(async (userId) =>
    loadCertifyContextForCreditBatchForUser(userId, creditBatchId),
  );
}
