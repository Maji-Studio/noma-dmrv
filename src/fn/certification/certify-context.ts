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
import {
  getCreditBatchById,
  type CreditBatchCo2eStoredPreview,
} from "@/data-access/credit-batches";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import {
  buildMassAccounting,
  EMPTY_RUN_SUMMARY,
  type RemovalRunSummary,
} from "@/lib/certification/mass-accounting";
import type { DerivedStatus } from "@/lib/certification/status";
import { SafeError } from "@/lib/errors";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
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
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
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
  defaultTemplate: IsometricRemovalTemplate | null;
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
          co2eStoredPreview: batch.co2eStoredPreview,
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
): Promise<RemovalScope> {
  const removal = await getCertifierRemovalById(userId, removalId);
  if (!removal) throw new SafeError("Removal not found");

  const batches = await getCreditBatchesByRemovalId(userId, removalId);
  const memberBatches = await Promise.all(
    batches.map(async (b) => {
      const full = await getCreditBatchById(userId, b.id, { skipPreview: true });
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
  defaultTemplate: IsometricRemovalTemplate | null;
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
    safeListIfConfigured(() => listRemovalTemplates(mapping.externalProjectId)),
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

  // Nothing to submit unless the facility resolves a clean default template AND
  // the removal carries applications — both gate the lineage walk. Either way
  // the removal-level half is empty; the facility half is whatever resolved.
  if (!facilityFacts.defaultTemplate || applicationIds.length === 0) {
    return {
      facilityId: scope.facilityId,
      removalId: scope.removalId,
      ...facilityFacts,
      memberBatches,
      transportCoverage: EMPTY_COVERAGE,
      hasSubmittableRuns: false,
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
    hasSubmittableRuns: runs.length > 0,
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
