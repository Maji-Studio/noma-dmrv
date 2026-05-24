"use server";

import { env } from "@/config/env";
import {
  getCertifierProjectByFacility,
  getLatestSubmission,
  type CertificationSubmissionRow,
  type CertifierProjectRow,
} from "@/data-access/certification";
import {
  getCertifierRemovalById,
  getCreditBatchesByRemovalId,
  listRemovalsForFacility,
  listUngroupedCreditBatches,
  type CertifierRemovalRow,
} from "@/data-access/certifier-removals";
import {
  getChainOfCustodyData,
  type ChainOfCustodyData,
} from "@/data-access/chain-of-custody";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";
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
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
  loadTransportLegsByCategory,
  safeListIfConfigured,
  type TransportLegsByCategory,
} from "./shared";

export interface TransportCoverageBucket {
  count: number;
  entityIds: string[];
  // Non-null when at least one leg fails the per-leg uniformity /
  // completeness checks `aggregateTransportLegs` enforces. Pooling legs from
  // several credit batches into one removal raises the chance of a mixed
  // method/factor — the panel surfaces it before the user clicks submit.
  aggregationWarning: string | null;
}

export interface TransportCoverage {
  feedstock: TransportCoverageBucket;
  biochar: TransportCoverageBucket;
  sample: TransportCoverageBucket;
}

export type TransportCategory = keyof TransportCoverage;

// Maps an INPUT_MAPPING.source field name to a transport category. Keep in
// sync with the three transport rows in transformers/datapoint.ts.
const TRANSPORT_SOURCE_TO_CATEGORY: Record<string, TransportCategory> = {
  feedstockTransportAvgDistanceKm: "feedstock",
  biocharTransportAvgDistanceKm: "biochar",
  sampleTransportAvgDistanceKm: "sample",
};

export interface MemberCreditBatch {
  id: string;
  code: string;
}

// UI-facing removal context — the lean payload React Query caches.
export interface RemovalCertifyContext {
  facilityId: string;
  // Null when the credit batch is not yet grouped into a removal (a 1:1
  // removal is created lazily on first submit).
  removalId: string | null;
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  defaultTemplate: IsometricRemovalTemplate | null;
  missingDefaultTemplateId: string | null;
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  // Every credit batch that maps into this removal (>= 1).
  memberBatches: MemberCreditBatch[];
  // Removal-level transport coverage — one aggregate set across all members.
  transportCoverage: TransportCoverage;
  requiredTransportCategories: TransportCategory[];
  latestSubmission: CertificationSubmissionRow | null;
  isProduction: boolean;
}

// Extends the UI context with the raw chain data the submit pipeline needs.
// Kept server-internal so the cached UI payload stays lean.
export interface RemovalSubmissionContext extends RemovalCertifyContext {
  lineages: ChainOfCustodyData[];
  runs: ProductionRunWithSamples[];
  // Per-run applied-biochar fraction (linear mass allocation). Passed to
  // `aggregateProductionRuns` so a partially-applied run contributes only
  // its applied share.
  attributionByRunId: Map<string, number>;
  // Transport legs pooled across every member batch's lineage, deduped by
  // entity id. Fed to `enrichWithTransportLegs` by the submit pipeline.
  transportLegs: TransportLegsByCategory;
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
  return (["feedstock", "biochar", "sample"] as const).filter((c) =>
    seen.has(c),
  );
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

const EMPTY_COVERAGE: TransportCoverage = {
  feedstock: { count: 0, entityIds: [], aggregationWarning: null },
  biochar: { count: 0, entityIds: [], aggregationWarning: null },
  sample: { count: 0, entityIds: [], aggregationWarning: null },
};

// The set of credit batches that compose one removal, with their facility.
interface RemovalScope {
  facilityId: string;
  removalId: string | null;
  removal: CertifierRemovalRow | null;
  memberBatches: { id: string; code: string; applicationIds: string[] }[];
}

// Resolves the removal scope for a credit batch. When the batch is already
// grouped, the scope is every member of that removal; otherwise it is the
// batch alone (a 1:1 removal that will be created lazily on submit).
async function resolveScopeForCreditBatch(
  userId: string,
  creditBatchId: string,
): Promise<RemovalScope> {
  const batch = await getCreditBatchById(userId, creditBatchId);
  if (!batch) throw new SafeError("Credit batch not found");

  if (!batch.removalId) {
    return {
      facilityId: batch.facilityId,
      removalId: null,
      removal: null,
      memberBatches: [
        { id: batch.id, code: batch.code, applicationIds: batch.applicationIds },
      ],
    };
  }
  return resolveScopeForRemoval(userId, batch.removalId);
}

// Resolves the removal scope from a removal id — every member credit batch.
async function resolveScopeForRemoval(
  userId: string,
  removalId: string,
): Promise<RemovalScope> {
  const removal = await getCertifierRemovalById(userId, removalId);
  if (!removal) throw new SafeError("Removal not found");

  const batches = await getCreditBatchesByRemovalId(userId, removalId);
  const memberBatches = await Promise.all(
    batches.map(async (b) => {
      const full = await getCreditBatchById(userId, b.id);
      return {
        id: b.id,
        code: b.code,
        applicationIds: full?.applicationIds ?? [],
      };
    }),
  );
  return {
    facilityId: removal.facilityId,
    removalId,
    removal,
    memberBatches,
  };
}

// Per-run applied-biochar fraction: applied dry kg reaching this removal's
// applications ÷ the run's total biochar output. Linear mass allocation —
// `aggregateProductionRuns` clamps the result into [0, 1].
function buildAttribution(
  lineages: ChainOfCustodyData[],
  runs: ProductionRunWithSamples[],
): Map<string, number> {
  const appliedKgByRun = new Map<string, number>();
  for (const lineage of lineages) {
    const runId = lineage.productionRun?.id;
    if (!runId) continue;
    const appliedTons = lineage.application.biocharAppliedDryTons ?? 0;
    appliedKgByRun.set(
      runId,
      (appliedKgByRun.get(runId) ?? 0) + tonnesToKg(appliedTons),
    );
  }
  const attribution = new Map<string, number>();
  for (const run of runs) {
    const appliedKg = appliedKgByRun.get(run.id) ?? 0;
    const output = run.biocharDryMassKg;
    // A null/zero output can't yield a fraction — fall back to full
    // attribution; aggregateProductionRuns warns separately on null mass.
    attribution.set(run.id, output && output > 0 ? appliedKg / output : 1);
  }
  return attribution;
}

// Builds the full submission context for one removal scope: resolves the
// Isometric mapping/template/blueprints, walks every member batch's
// application lineage into a deduped union of production runs, and computes
// the removal-level transport coverage + applied-biochar attribution.
async function buildRemovalContext(
  userId: string,
  scope: RemovalScope,
): Promise<RemovalSubmissionContext> {
  const isProduction = env.ISOMETRIC_ENVIRONMENT === "production";
  const memberBatches: MemberCreditBatch[] = scope.memberBatches.map((b) => ({
    id: b.id,
    code: b.code,
  }));

  const latestSubmission = scope.removalId
    ? await getLatestSubmission(userId, {
        provider: ISOMETRIC_PROVIDER,
        submissionType: REMOVAL_SUBMISSION_TYPE,
        localEntityType: REMOVAL_ENTITY_TYPE,
        localEntityId: scope.removalId,
      })
    : null;

  const base = {
    facilityId: scope.facilityId,
    removalId: scope.removalId,
    memberBatches,
    latestSubmission,
    isProduction,
    lineages: [] as ChainOfCustodyData[],
    runs: [] as ProductionRunWithSamples[],
    attributionByRunId: new Map<string, number>(),
    transportLegs: {
      feedstock: [],
      biochar: [],
      sample: [],
    } as TransportLegsByCategory,
    transportCoverage: EMPTY_COVERAGE,
    requiredTransportCategories: [] as TransportCategory[],
  };

  const mapping = await getCertifierProjectByFacility(
    userId,
    scope.facilityId,
    ISOMETRIC_PROVIDER,
  );
  if (!mapping) {
    return {
      ...base,
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
      ...base,
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
      ...base,
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
    if (found) blueprintsForTemplate.push(found);
    else unresolvedBlueprintKeys.push(key);
  }

  const requiredTransportCategories =
    deriveRequiredTransportCategories(defaultTemplate);

  // Walk every member batch's applications into one deduped run union.
  const applicationIds = Array.from(
    new Set(scope.memberBatches.flatMap((b) => b.applicationIds)),
  );
  if (applicationIds.length === 0) {
    return {
      ...base,
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
    applicationIds.map((id) => getChainOfCustodyData(userId, id)),
  );
  const runIds = Array.from(
    new Set(
      lineages
        .map((l) => l.productionRun?.id)
        .filter((id): id is string => !!id),
    ),
  );
  const runs =
    runIds.length > 0
      ? await getProductionRunsWithSamples(userId, runIds)
      : [];

  const entityIds = collectTransportEntityIds(lineages, runs);
  const transportLegs = await loadTransportLegsByCategory(userId, entityIds);
  const transportCoverage = buildCoverage(transportLegs, entityIds);
  const attributionByRunId = buildAttribution(lineages, runs);

  return {
    facilityId: scope.facilityId,
    removalId: scope.removalId,
    mapping,
    project,
    defaultTemplate,
    missingDefaultTemplateId: null,
    blueprintsForTemplate,
    unresolvedBlueprintKeys,
    memberBatches,
    transportCoverage,
    requiredTransportCategories,
    latestSubmission,
    isProduction,
    lineages,
    runs,
    attributionByRunId,
    transportLegs,
  };
}

// Submission-pipeline context keyed by removal id — used by `submitRemoval`.
export async function loadRemovalSubmissionContext(
  userId: string,
  removalId: string,
): Promise<RemovalSubmissionContext> {
  return buildRemovalContext(
    userId,
    await resolveScopeForRemoval(userId, removalId),
  );
}

function projectUiContext(
  ctx: RemovalSubmissionContext,
): RemovalCertifyContext {
  return {
    facilityId: ctx.facilityId,
    removalId: ctx.removalId,
    mapping: ctx.mapping,
    project: ctx.project,
    defaultTemplate: ctx.defaultTemplate,
    missingDefaultTemplateId: ctx.missingDefaultTemplateId,
    blueprintsForTemplate: ctx.blueprintsForTemplate,
    unresolvedBlueprintKeys: ctx.unresolvedBlueprintKeys,
    memberBatches: ctx.memberBatches,
    transportCoverage: ctx.transportCoverage,
    requiredTransportCategories: ctx.requiredTransportCategories,
    latestSubmission: ctx.latestSubmission,
    isProduction: ctx.isProduction,
  };
}

// UI context for the credit-batch Certify panel. Resolves the removal the
// batch belongs to (or a 1:1 preview when it is not yet grouped).
export async function loadCertifyContextForCreditBatchForUser(
  userId: string,
  creditBatchId: string,
): Promise<RemovalCertifyContext> {
  const scope = await resolveScopeForCreditBatch(userId, creditBatchId);
  return projectUiContext(await buildRemovalContext(userId, scope));
}

export async function loadCertifyContextForCreditBatch(
  creditBatchId: string,
): Promise<ActionResult<RemovalCertifyContext>> {
  return withAction(async (userId) =>
    loadCertifyContextForCreditBatchForUser(userId, creditBatchId),
  );
}

export interface CreditBatchRunRef {
  id: string;
  code: string;
}

// Lightweight production-run resolver for a credit batch — walks the
// application lineage only (no Isometric API calls), deduplicates, sorted by
// id. Retained for the dormant GHG-statement state loader (ADR 0003).
export async function loadCreditBatchRunRefs(
  userId: string,
  creditBatchId: string,
): Promise<CreditBatchRunRef[]> {
  const creditBatch = await getCreditBatchById(userId, creditBatchId);
  if (!creditBatch || creditBatch.applicationIds.length === 0) return [];
  const lineages = await Promise.all(
    creditBatch.applicationIds.map((id) => getChainOfCustodyData(userId, id)),
  );
  const byId = new Map<string, string>();
  for (const lineage of lineages) {
    if (lineage.productionRun) {
      byId.set(lineage.productionRun.id, lineage.productionRun.code);
    }
  }
  return Array.from(byId, ([id, code]) => ({ id, code })).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

export interface RemovalHubEntry {
  removal: CertifierRemovalRow;
  memberBatches: MemberCreditBatch[];
  latestSubmission: CertificationSubmissionRow | null;
}

export interface RemovalsHubData {
  removals: RemovalHubEntry[];
  ungroupedBatches: MemberCreditBatch[];
  // Whether submits from the hub write to the production Isometric registry —
  // drives the confirmation gate on the hub's Submit button.
  isProduction: boolean;
}

// Removals hub payload for a facility: every removal with its member credit
// batches + latest submission, plus the pool of credit batches not yet
// grouped into a removal.
export async function loadRemovalsForFacility(
  facilityId: string,
): Promise<ActionResult<RemovalsHubData>> {
  return withAction(async (userId) => {
    const [removalRows, ungroupedBatches] = await Promise.all([
      listRemovalsForFacility(userId, facilityId),
      listUngroupedCreditBatches(userId, facilityId),
    ]);
    const removals = await Promise.all(
      removalRows.map(async (removal) => {
        const [batches, latestSubmission] = await Promise.all([
          getCreditBatchesByRemovalId(userId, removal.id),
          getLatestSubmission(userId, {
            provider: ISOMETRIC_PROVIDER,
            submissionType: REMOVAL_SUBMISSION_TYPE,
            localEntityType: REMOVAL_ENTITY_TYPE,
            localEntityId: removal.id,
          }),
        ]);
        return {
          removal,
          memberBatches: batches.map((b) => ({ id: b.id, code: b.code })),
          latestSubmission,
        };
      }),
    );
    return {
      removals,
      ungroupedBatches,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    };
  });
}
