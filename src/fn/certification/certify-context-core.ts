import { env } from "@/config/env";
import {
  getCertifierProjectByFacility,
  type CertificationSubmissionRow,
  type CertifierProjectRow,
} from "@/data-access/certification";
import { getLatestSubmission } from "@/data-access/certification-submissions";
import {
  getCertifierRemovalById,
  getCreditBatchesByRemovalId,
  listRemovalsForFacility,
  listUngroupedCreditBatches,
  type CertifierRemovalRow,
  type UngroupedCreditBatchRow,
} from "@/data-access/certifier-removals";
import {
  getChainOfCustodyData,
  type ChainOfCustodyData,
} from "@/data-access/chain-of-custody";
import {
  getCreditBatchById,
  type CreditBatchCo2eStoredPreview,
} from "@/data-access/credit-batches";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
import {
  deriveBatchHealth,
  type BatchHealth,
} from "@/lib/certification/batch-health";
import { toBatchHealthFacts } from "@/lib/certification/batch-health-facts";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import {
  buildMassAccounting,
  EMPTY_RUN_SUMMARY,
  type RemovalRunSummary,
} from "@/lib/certification/mass-accounting";
import {
  defaultProductionReadinessGap,
  type ProductionReadinessGap,
} from "@/lib/certification/production-readiness";
import type { DerivedStatus } from "@/lib/certification/status";
import { SafeError } from "@/lib/errors";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import {
  aggregateTransportLegs,
  collectTransportEntityIds,
  listComponentBlueprints,
  listProjects,
  listGhgEntryTemplates,
  type IsometricComponentBlueprint,
  type IsometricProject,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import { lookupInputMapping } from "@/lib/isometric/transformers/datapoint";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
  loadTransportLegsByCategory,
  safeListIfConfigured,
  type TransportLegsByCategory,
} from "./shared";

// Each removal/batch in a facility-level fan-out rebuilds its own context (a
// chain of DB queries + registry lookups). Bound how many run at once so a
// facility with many removals/batches can't burst an unbounded number of query
// chains at the connection pool. Mirrors `READINESS_CONCURRENCY` in overview.ts.
const FANOUT_CONCURRENCY = 8;

export interface TransportCoverageBucket {
  count: number;
  entityIds: string[];
  legIds: string[];
  firstLegEntityId: string | null;
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
  co2eStoredPreview?: CreditBatchCo2eStoredPreview;
}

type DurabilityOption = "200_year" | "1000_year";

// The GHG Statement this removal has been rolled into (if any), with its
// derived verifier status. Carried separately from the removal's own
// `latestSubmission` so the bridge can show the statement's status without
// ever attributing a verifier lifecycle to the removal itself (P1-b). The
// status is derived server-side (`deriveSubmissionStatus(..., "ghgStatement")`)
// so the cached UI payload stays a lean value/label, not a submission row.
export interface LinkedGhgStatementStatus {
  id: string;
  status: DerivedStatus;
}

// UI-facing removal context — the lean payload React Query caches.
export interface RemovalCertifyContext {
  facilityId: string;
  // Null when the credit batch is not yet grouped into a removal (a 1:1
  // removal is created lazily on first submit).
  removalId: string | null;
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  defaultTemplate: IsometricGhgEntryTemplate | null;
  missingDefaultTemplateId: string | null;
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  // Every credit batch that maps into this removal (>= 1).
  memberBatches: MemberCreditBatch[];
  // Removal-level transport coverage — one aggregate set across all members.
  transportCoverage: TransportCoverage;
  requiredTransportCategories: TransportCategory[];
  // True once member-batch lineage resolves at least one production run —
  // i.e. there is something to submit. Surfaced on the UI context so the
  // client-side readiness classifier (review pre-flight) sees the same
  // `hasSubmittableRuns` fact the server-owned Overview loader does, without
  // shipping the heavy `runs` array to the client.
  hasSubmittableRuns: boolean;
  // Specific blocker when production lineage does not resolve a run. This keeps
  // no-applications / broken-product-link cases out of the generic production
  // bucket on health and readiness surfaces.
  productionReadinessGap: ProductionReadinessGap | null;
  // Compact labels from the per-entity certifier-readiness layer. The raw
  // entity rows stay server-side; Review/pre-flight only needs gap labels.
  entityReadinessGaps?: string[];
  // Focused run aggregation (run count, total biochar output, applied dry kg)
  // surfaced on the lean UI context so the Review step can show what's being
  // submitted without shipping the heavy `runs` array.
  runSummary: RemovalRunSummary;
  latestSubmission: CertificationSubmissionRow | null;
  // The GHG Statement this removal rolls into + its verifier status, or null
  // when the removal isn't linked to one. See `LinkedGhgStatementStatus`.
  linkedGhgStatement: LinkedGhgStatementStatus | null;
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
  template: IsometricGhgEntryTemplate,
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
      legIds: legs.feedstock.map((leg) => leg.id),
      firstLegEntityId: legs.feedstock[0]?.entityId ?? null,
      aggregationWarning: aggregateTransportLegs(legs.feedstock, "Feedstock")
        .warning,
    },
    biochar: {
      count: legs.biochar.length,
      entityIds: entityIds.biocharProductIds,
      legIds: legs.biochar.map((leg) => leg.id),
      firstLegEntityId: legs.biochar[0]?.entityId ?? null,
      aggregationWarning: aggregateTransportLegs(legs.biochar, "Biochar")
        .warning,
    },
    sample: {
      count: legs.sample.length,
      entityIds: entityIds.sampleIds,
      legIds: legs.sample.map((leg) => leg.id),
      firstLegEntityId: legs.sample[0]?.entityId ?? null,
      aggregationWarning: aggregateTransportLegs(legs.sample, "Sample").warning,
    },
  };
}

function buildEntityReadinessGaps(
  runs: ProductionRunWithSamples[],
  transportLegs: TransportLegsByCategory,
  requiredTransportCategories: readonly TransportCategory[],
  runIdsRequiring1000YearDurability: ReadonlySet<string>,
): string[] {
  const gaps: string[] = [];
  const addEntityGaps = (
    entityLabel: string,
    readinessGaps: ReturnType<typeof deriveEntityCertifyReadiness>["gaps"],
  ) => {
    if (readinessGaps.length === 0) return;
    gaps.push(
      `${entityLabel}: ${readinessGaps.map((gap) => gap.label).join(" · ")}`,
    );
  };

  for (const run of runs) {
    addEntityGaps(
      `Production run ${run.code}`,
      deriveEntityCertifyReadiness("productionRun", run).gaps,
    );
    for (const sample of run.samples) {
      const durabilityOption: DurabilityOption =
        runIdsRequiring1000YearDurability.has(run.id)
          ? "1000_year"
          : "200_year";
      addEntityGaps(
        `Sample ${sample.sampleCode}`,
        deriveEntityCertifyReadiness("sample", {
          ...sample,
          durabilityOption,
        }).gaps,
      );
    }
  }

  for (const category of requiredTransportCategories) {
    const legs = transportLegs[category];
    for (const leg of legs) {
      addEntityGaps(
        `${category} transport leg ${leg.id}`,
        deriveEntityCertifyReadiness("transportLeg", leg).gaps,
      );
    }
  }

  return Array.from(new Set(gaps));
}

const EMPTY_COVERAGE: TransportCoverage = {
  feedstock: {
    count: 0,
    entityIds: [],
    legIds: [],
    firstLegEntityId: null,
    aggregationWarning: null,
  },
  biochar: {
    count: 0,
    entityIds: [],
    legIds: [],
    firstLegEntityId: null,
    aggregationWarning: null,
  },
  sample: {
    count: 0,
    entityIds: [],
    legIds: [],
    firstLegEntityId: null,
    aggregationWarning: null,
  },
};

// The set of credit batches that compose one removal, with their facility.
interface RemovalScope {
  facilityId: string;
  removalId: string | null;
  removal: CertifierRemovalRow | null;
  memberBatches: {
    id: string;
    code: string;
    applicationIds: string[];
    durabilityOption: DurabilityOption;
    co2eStoredPreview?: CreditBatchCo2eStoredPreview;
  }[];
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
        {
          id: batch.id,
          code: batch.code,
          applicationIds: batch.applicationIds,
          durabilityOption: batch.durabilityOption,
          co2eStoredPreview: batch.co2eStoredPreview ?? undefined,
        },
      ],
    };
  }
  return resolveScopeForRemoval(userId, batch.removalId);
}

// Resolves the removal scope from a removal id — every member credit batch.
export async function resolveScopeForRemoval(
  userId: string,
  removalId: string,
  options?: { skipPreview?: boolean },
): Promise<RemovalScope> {
  const removal = await getCertifierRemovalById(userId, removalId);
  if (!removal) throw new SafeError("Removal not found");

  const batches = await getCreditBatchesByRemovalId(userId, removalId);
  const memberBatches = await Promise.all(
    batches.map(async (b) => {
      const full = options?.skipPreview
        ? await getCreditBatchById(userId, b.id, { skipPreview: true })
        : await getCreditBatchById(userId, b.id);
      // Fail fast rather than emitting a member batch with empty
      // applicationIds / missing preview — partial data here silently
      // understates a removal's scope downstream.
      if (!full) {
        throw new SafeError(
          `Credit batch ${b.id} in removal ${removalId} could not be loaded`,
        );
      }
      return {
        id: full.id,
        code: full.code,
        applicationIds: full.applicationIds,
        durabilityOption: full.durabilityOption,
        co2eStoredPreview: full.co2eStoredPreview ?? undefined,
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

// Resolves the GHG Statement a removal rolls into (via the persisted
// `ghgStatementId` FK) and derives its verifier status from the statement's
// own latest submission — the same `metadata.remoteStatus` overlay the GHG
// Statements list reads. Returns null when the removal isn't grouped or isn't
// linked to a statement. Kept lean (id + derived status) so it can ride on the
// cached UI context.
async function loadLinkedGhgStatementStatus(
  userId: string,
  removal: CertifierRemovalRow | null,
): Promise<LinkedGhgStatementStatus | null> {
  const ghgStatementId = removal?.ghgStatementId ?? null;
  if (!ghgStatementId) return null;

  const latest = await getLatestSubmission(userId, {
    provider: ISOMETRIC_PROVIDER,
    submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
    localEntityType: GHG_STATEMENT_ENTITY_TYPE,
    localEntityId: ghgStatementId,
  });
  return {
    id: ghgStatementId,
    status: deriveSubmissionStatus(
      latest,
      latest ? isLockedInFlight(latest) : false,
      "ghgStatement",
    ),
  };
}

// The facility-scoped half of a removal's submission context: the Isometric
// mapping + (when it resolves cleanly) the project / default template /
// referenced component blueprints, and the transport categories that template
// requires. These depend only on the facility, so the Overview work queue
// resolves them ONCE and feeds them to every removal's `buildRemovalContext`
// instead of re-pulling the same template/blueprint data per row.
export interface FacilityCertifierFacts {
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  defaultTemplate: IsometricGhgEntryTemplate | null;
  missingDefaultTemplateId: string | null;
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  requiredTransportCategories: TransportCategory[];
}

// Facility facts before any mapping resolves — also the shape every
// not-fully-configured short-circuit carries (the template-dependent fields
// stay empty).
const UNRESOLVED_FACILITY_FACTS: Omit<
  FacilityCertifierFacts,
  "mapping" | "project"
> = {
  defaultTemplate: null,
  missingDefaultTemplateId: null,
  blueprintsForTemplate: [],
  unresolvedBlueprintKeys: [],
  requiredTransportCategories: [],
};

// Resolves the facility-scoped certifier facts: the Isometric mapping and, when
// it resolves cleanly, the project / default template / referenced component
// blueprints + the template's required transport categories. Short-circuits the
// same way the single-pass builder did — no mapping skips every remote list; no
// default template skips the blueprint catalog — so the remote-call fan-out per
// facility is unchanged.
export async function loadFacilityCertifierFacts(
  userId: string,
  facilityId: string,
): Promise<FacilityCertifierFacts> {
  const mapping = await getCertifierProjectByFacility(
    userId,
    facilityId,
    ISOMETRIC_PROVIDER,
  );
  if (!mapping) {
    return { mapping: null, project: null, ...UNRESOLVED_FACILITY_FACTS };
  }

  const [projects, templates] = await Promise.all([
    safeListIfConfigured(() => listProjects()),
    safeListIfConfigured(() => listGhgEntryTemplates(mapping.externalProjectId)),
  ]);
  const project =
    projects.find((p) => p.id === mapping.externalProjectId) ?? null;

  if (!mapping.defaultRemovalTemplateId) {
    return { mapping, project, ...UNRESOLVED_FACILITY_FACTS };
  }

  const defaultTemplate =
    templates.find((t) => t.id === mapping.defaultRemovalTemplateId) ?? null;
  if (!defaultTemplate) {
    return {
      mapping,
      project,
      ...UNRESOLVED_FACILITY_FACTS,
      missingDefaultTemplateId: mapping.defaultRemovalTemplateId,
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

  return {
    mapping,
    project,
    defaultTemplate,
    missingDefaultTemplateId: null,
    blueprintsForTemplate,
    unresolvedBlueprintKeys,
    requiredTransportCategories:
      deriveRequiredTransportCategories(defaultTemplate),
  };
}

function collect1000YearDurabilityRunIds(
  scope: RemovalScope,
  lineageByApplicationId: ReadonlyMap<string, ChainOfCustodyData>,
): Set<string> {
  const runIds = new Set<string>();
  for (const batch of scope.memberBatches) {
    if (batch.durabilityOption !== "1000_year") continue;
    for (const applicationId of batch.applicationIds) {
      const runId = lineageByApplicationId.get(applicationId)?.productionRun?.id;
      if (runId) runIds.add(runId);
    }
  }
  return runIds;
}

function productionReadinessGapFromLineages(
  lineages: ChainOfCustodyData[],
): ProductionReadinessGap | null {
  if (lineages.every((lineage) => lineage.productionRun)) {
    return null;
  }

  const missingProduct = lineages.find((lineage) => !lineage.biocharProduct);
  if (missingProduct) {
    return {
      kind: "missingBiocharProduct",
      detail: `Application ${missingProduct.application.code} is not linked to a biochar product through its delivery or order`,
      fixTarget: "deliveries",
    };
  }

  const productMissingRun = lineages.find(
    (lineage) =>
      lineage.biocharProduct && !lineage.biocharProduct.linkedProductionRunId,
  );
  if (productMissingRun?.biocharProduct) {
    return {
      kind: "biocharProductMissingRun",
      detail: `Biochar product ${productMissingRun.biocharProduct.code} is not linked to a production run`,
      fixTarget: "biocharProducts",
    };
  }

  const missingRun = lineages.find(
    (lineage) =>
      lineage.biocharProduct?.linkedProductionRunId && !lineage.productionRun,
  );
  if (missingRun?.biocharProduct) {
    return {
      kind: "productionRunMissing",
      detail: `Biochar product ${missingRun.biocharProduct.code} links to a production run that could not be loaded`,
      fixTarget: "biocharProducts",
    };
  }

  return defaultProductionReadinessGap();
}

// Composes one removal's full submission context from its resolved scope and
// the facility-scoped certifier facts (loaded once per facility, passed in).
// The facility half spreads straight onto the context; this only adds the
// removal-level half — submission status, member-batch lineage, the deduped
// production-run union, transport coverage, and mass accounting.
export async function buildRemovalContext(
  userId: string,
  scope: RemovalScope,
  facilityFacts: FacilityCertifierFacts,
): Promise<RemovalSubmissionContext> {
  const isProduction = env.ISOMETRIC_ENVIRONMENT === "production";
  const memberBatches: MemberCreditBatch[] = scope.memberBatches.map((b) => ({
    id: b.id,
    code: b.code,
    co2eStoredPreview: b.co2eStoredPreview,
  }));

  // The removal's own submission + its linked GHG Statement status resolve from
  // the scope alone, so load them up-front: every short-circuit path then
  // carries the real values rather than a placeholder.
  const [latestSubmission, linkedGhgStatement] = await Promise.all([
    scope.removalId
      ? getLatestSubmission(userId, {
          provider: ISOMETRIC_PROVIDER,
          submissionType: REMOVAL_SUBMISSION_TYPE,
          localEntityType: REMOVAL_ENTITY_TYPE,
          localEntityId: scope.removalId,
        })
      : Promise.resolve(null),
    loadLinkedGhgStatementStatus(userId, scope.removal),
  ]);

  // Walk every member batch's applications into one deduped run union.
  const applicationIds = Array.from(
    new Set(scope.memberBatches.flatMap((b) => b.applicationIds)),
  );

  // Nothing to submit when the removal carries no applications. Facility
  // template setup does NOT gate the lineage walk; otherwise setup gaps collapse
  // into a misleading "no production data" blocker.
  if (applicationIds.length === 0) {
    const productionReadinessGap: ProductionReadinessGap = {
      kind: "noApplications",
      detail: scope.removalId
        ? "No applications linked to this removal"
        : "No applications linked to this batch",
      fixTarget: "batchDetails",
    };
    return {
      facilityId: scope.facilityId,
      removalId: scope.removalId,
      ...facilityFacts,
      memberBatches,
      transportCoverage: EMPTY_COVERAGE,
      hasSubmittableRuns: false,
      productionReadinessGap,
      entityReadinessGaps: [],
      runSummary: EMPTY_RUN_SUMMARY,
      latestSubmission,
      linkedGhgStatement,
      isProduction,
      lineages: [],
      runs: [],
      attributionByRunId: new Map<string, number>(),
      transportLegs: { feedstock: [], biochar: [], sample: [] },
    };
  }

  const lineages = await Promise.all(
    applicationIds.map((id) => getChainOfCustodyData(userId, id)),
  );
  const lineageByApplicationId = new Map(
    lineages.map((lineage, index) => [applicationIds[index], lineage]),
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
  const productionReadinessGap = productionReadinessGapFromLineages(lineages);

  const entityIds = collectTransportEntityIds(lineages, runs);
  const transportLegs = await loadTransportLegsByCategory(userId, entityIds);
  const transportCoverage = buildCoverage(transportLegs, entityIds);
  const runIdsRequiring1000YearDurability =
    collect1000YearDurabilityRunIds(scope, lineageByApplicationId);
  const entityReadinessGaps = buildEntityReadinessGaps(
    runs,
    transportLegs,
    facilityFacts.requiredTransportCategories,
    runIdsRequiring1000YearDurability,
  );
  // One mass-accounting walk: the per-run attribution the submit pipeline
  // scopes by AND the Review-flow summary, so the two can never diverge.
  const { attributionByRunId, runSummary } = buildMassAccounting(
    lineages,
    runs,
  );

  return {
    facilityId: scope.facilityId,
    removalId: scope.removalId,
    ...facilityFacts,
    memberBatches,
    transportCoverage,
    hasSubmittableRuns: runs.length > 0 && !productionReadinessGap,
    productionReadinessGap,
    entityReadinessGaps,
    runSummary,
    latestSubmission,
    linkedGhgStatement,
    isProduction,
    lineages,
    runs,
    attributionByRunId,
    transportLegs,
  };
}

// Submission-pipeline context keyed by removal id — used by `submitRemoval`.
// Resolves the scope, then the facility facts for that scope's facility, then
// composes; the Overview queue reuses `buildRemovalContext` with facility facts
// loaded once across all of a facility's removals.
export async function loadRemovalSubmissionContext(
  userId: string,
  removalId: string,
): Promise<RemovalSubmissionContext> {
  const scope = await resolveScopeForRemoval(userId, removalId);
  const facilityFacts = await loadFacilityCertifierFacts(
    userId,
    scope.facilityId,
  );
  return buildRemovalContext(userId, scope, facilityFacts);
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
    hasSubmittableRuns: ctx.hasSubmittableRuns,
    productionReadinessGap: ctx.productionReadinessGap,
    entityReadinessGaps: ctx.entityReadinessGaps,
    runSummary: ctx.runSummary,
    latestSubmission: ctx.latestSubmission,
    linkedGhgStatement: ctx.linkedGhgStatement,
    isProduction: ctx.isProduction,
  };
}

// UI context keyed by removal id — the guided Review flow's source of truth
// (Assemble / Review / Pre-flight read it; the pre-flight runs the shared
// `deriveRemovalReadiness` classifier against it). Mirrors
// `loadCertifyContextForCreditBatch` but resolves the scope from the removal.
export async function loadRemovalCertifyContext(
  removalId: string,
): Promise<ActionResult<RemovalCertifyContext>> {
  return withAction(async (userId) =>
    projectUiContext(await loadRemovalSubmissionContext(userId, removalId)),
  );
}

// UI context for the credit-batch Certify panel. Resolves the removal the
// batch belongs to (or a 1:1 preview when it is not yet grouped).
export async function loadCertifyContextForCreditBatchForUser(
  userId: string,
  creditBatchId: string,
): Promise<RemovalCertifyContext> {
  const scope = await resolveScopeForCreditBatch(userId, creditBatchId);
  const facilityFacts = await loadFacilityCertifierFacts(
    userId,
    scope.facilityId,
  );
  return projectUiContext(
    await buildRemovalContext(userId, scope, facilityFacts),
  );
}

export async function loadCertifyContextForCreditBatch(
  creditBatchId: string,
): Promise<ActionResult<RemovalCertifyContext>> {
  return withAction(async (userId) =>
    loadCertifyContextForCreditBatchForUser(userId, creditBatchId),
  );
}

// Same as `loadCertifyContextForCreditBatchForUser` but reuses caller-supplied
// facility facts instead of loading them per call. A multi-batch confirm (the
// New-Removal wizard) loads `loadFacilityCertifierFacts` — which includes the
// facility's Isometric registry calls — ONCE for the shared facility, then
// builds each batch's context with these facts rather than re-fetching them per
// batch. Safe because `facilityId`/`removalId`/`memberBatches` come from the
// per-batch scope; the facts only feed health-relevant fields the caller reads
// after confirming the batch belongs to that facility.
export async function buildCreditBatchContextWithFacts(
  userId: string,
  creditBatchId: string,
  facilityFacts: FacilityCertifierFacts,
): Promise<RemovalCertifyContext> {
  const scope = await resolveScopeForCreditBatch(userId, creditBatchId);
  return projectUiContext(
    await buildRemovalContext(userId, scope, facilityFacts),
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
    // Bounded chunks (order-preserving) rather than one unbounded Promise.all
    // over every removal — see FANOUT_CONCURRENCY.
    const removals: RemovalHubEntry[] = [];
    for (let i = 0; i < removalRows.length; i += FANOUT_CONCURRENCY) {
      const chunk = await Promise.all(
        removalRows.slice(i, i + FANOUT_CONCURRENCY).map(async (removal) => {
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
      removals.push(...chunk);
    }
    return {
      removals,
      ungroupedBatches,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    };
  });
}

// One ungrouped credit batch with its per-batch health verdict — a selection
// card in the New-Removal wizard's first step.
export interface SelectableBatch extends UngroupedCreditBatchRow {
  health: BatchHealth;
}

export interface SelectableBatchesData {
  batches: SelectableBatch[];
  // Facility setup (project mapping + cleanly-resolving default template) is
  // done. When false the wizard shows a "finish facility setup" banner and the
  // transport health check on each batch reads `skipped` (design doc §8).
  facilitySetupComplete: boolean;
  // Whether a submit from this facility writes to the production registry —
  // drives the wizard's production confirmation gate.
  isProduction: boolean;
}

// Selection-step payload for the New-Removal wizard: every ungrouped credit
// batch in the facility paired with the SAME health verdict the credit-batch
// detail page shows. Loads the facility certifier facts ONCE and reuses them
// across every batch's context build (the facts are facility-scoped, so a
// per-batch reload would just repeat the same remote calls). Server-authoritative
// gating still happens at confirm time in `createRemovalWithBatchesAction`; this
// only drives which cards are selectable.
export async function loadSelectableBatchesForFacility(
  facilityId: string,
): Promise<ActionResult<SelectableBatchesData>> {
  return withAction(async (userId) => {
    const facilityFacts = await loadFacilityCertifierFacts(userId, facilityId);
    const ungrouped = await listUngroupedCreditBatches(userId, facilityId);
    // Bounded chunks (order-preserving) rather than one unbounded Promise.all
    // over every ungrouped batch — see FANOUT_CONCURRENCY.
    const batches: SelectableBatch[] = [];
    for (let i = 0; i < ungrouped.length; i += FANOUT_CONCURRENCY) {
      const chunk = await Promise.all(
        ungrouped.slice(i, i + FANOUT_CONCURRENCY).map(async (row) => {
          const scope = await resolveScopeForCreditBatch(userId, row.id);
          const ctx = projectUiContext(
            await buildRemovalContext(userId, scope, facilityFacts),
          );
          return {
            ...row,
            health: deriveBatchHealth(toBatchHealthFacts(ctx, row.id)),
          };
        }),
      );
      batches.push(...chunk);
    }
    const facilitySetupComplete =
      !!facilityFacts.mapping &&
      !!facilityFacts.defaultTemplate &&
      !facilityFacts.missingDefaultTemplateId &&
      facilityFacts.unresolvedBlueprintKeys.length === 0;
    return {
      batches,
      facilitySetupComplete,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    };
  });
}
