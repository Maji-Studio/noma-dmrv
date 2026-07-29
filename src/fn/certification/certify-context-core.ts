import type { OrgContext } from "@/lib/auth/server";
import { env } from "@/config/env";
import { hasCertifierCredentials } from "@/data-access/certifier-credentials";
import {
  getCertifierProjectByFacility,
  type CertificationSubmissionRow,
  type CertifierProjectRow,
} from "@/data-access/certification";
import { requireOrgFacility } from "@/data-access/utils";
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
  projectChainOfCustodyFromBatchFacts,
  type ChainOfCustodyData,
} from "@/data-access/chain-of-custody";
import {
  loadCreditBatchRollups,
  type CreditBatchRollup,
  type CreditBatchRollupsByBatch,
} from "@/data-access/credit-batch-accounting";
import { getCreditBatchRemovalId } from "@/data-access/credit-batches";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
import {
  buildMassAccounting,
  EMPTY_RUN_SUMMARY,
  type RemovalRunSummary,
} from "@/lib/certification/mass-accounting";
import {
  defaultProductionReadinessGap,
  type ProductionReadinessGap,
} from "@/lib/certification/production-readiness";
import { attributeSoilTemperatureBlockers } from "@/lib/certification/member-batch-gates";
import { SafeError } from "@/lib/errors";
import {
  aggregateTransportMassDistance,
  collectTransportEntityIds,
  getIsometricClientForOrg,
  listComponentBlueprints,
  listProjects,
  listGhgEntryTemplates,
  type IsometricComponentBlueprint,
  type IsometricProject,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import { lookupInputMapping } from "@/lib/isometric/transformers/datapoint";
import { hasExplicitSequestrationBinding } from "@/lib/isometric/transformers/sequestration-binding";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import {
  buildSoilTemperatureGate,
  resolveFacilityReferenceSoilTemperature,
  type FacilityReferenceSoilTemperature,
} from "@/lib/isometric/utils/durability-aggregation";
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
import { buildCertifyEntityReadiness } from "./certify-entity-readiness";
import { loadDurabilityBatchData } from "./durability-readiness";
import { collectFutureDatedMeasurements } from "./future-dated-measurements";
import { buildSubmissionWarnings } from "./submission-warnings";
import { loadEvidenceMirrorSummaryForScope, type EvidenceMirrorSummary } from "./evidence-mirror-summary";
import {
  loadLinkedGhgStatementStatus,
  type LinkedGhgStatementStatus,
} from "./linked-ghg-statement-status";
import {
  buildSelectableBatchesData,
  type SelectableBatchesData,
} from "./selectable-batches";
import {
  toMemberCreditBatch,
  toMemberCreditBatchView,
  type MemberCreditBatch,
} from "./member-credit-batch";

export type { LinkedGhgStatementStatus } from "./linked-ghg-statement-status";
export type { SelectableBatch, SelectableBatchesData } from "./selectable-batches";
export type { MemberCreditBatch } from "./member-credit-batch";

// Bound facility fan-out so per-removal DB/registry query chains cannot burst
// the connection pool. Mirrors `READINESS_CONCURRENCY` in overview.ts.
const FANOUT_CONCURRENCY = 8;

export interface TransportCoverageBucket {
  count: number;
  entityIds: string[];
  legIds: string[];
  firstLegEntityId: string | null;
  // Non-null when at least one leg fails the per-leg uniformity /
  // completeness checks `aggregateTransportMassDistance` enforces. Pooling legs from
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
  feedstockTransportMassDistanceTonneKm: "feedstock",
  biocharTransportMassDistanceTonneKm: "biochar",
  sampleTransportMassDistanceTonneKm: "sample",
};

type DurabilityOption = "200_year" | "1000_year";

// UI-facing removal context — the lean payload React Query caches.
export interface RemovalCertifyContext {
  facilityId: string;
  hasOrgCredentials: boolean;
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
  // Compact labels from the per-entity certifier-readiness layer; the submit
  // pipeline gates on this same list, so [] means entity-ready.
  entityReadinessGaps: string[];
  entityReadinessIssues?: import("@/lib/certification/batch-health").BatchEntityReadinessIssue[];
  // Fail-closed durability sampling/eligibility blockers (D3) — the EXACT list
  // the submit pipeline blocks on, so readiness predicts the gate. [] ⇒ ready.
  durabilityGateBlockers: string[];
  // Production-run end times / biochar application dates that still lie in the
  // future, phrased as blocker sentences. The SAME verdict the submit-time
  // guard `assertRemovalDatesNotFuture` reaches, computed here against the
  // server clock so the readiness classifier can stay pure and clock-free.
  // [] ⇒ every measurement date has already happened.
  futureDatedMeasurements: string[];
  // Non-blocking submission advisories — e.g. recorded startup/plant diesel the
  // active template has no component to carry (ADR 0015). Unlike
  // durabilityGateBlockers / entityReadinessGaps, these do NOT gate submission;
  // they tell the operator a recorded value will not be submitted.
  submissionWarnings: string[];
  supportingDocuments: EvidenceMirrorSummary;
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
  // The removal's member credit batches with their pooled lab Samples (by
  // `samples.creditBatchId`) — the CREDIT-BATCH-grained durability data plane
  // (ADR 0016). Drives the durability gates here and the per-batch
  // measurement-sample submission step (Phase 3). Each batch's `runs` are scoped
  // to the removal's applied run set so product mass is attribution-correct.
  batchesWithSamples: CreditBatchWithSamples[];
  // Per-run applied-biochar fraction (linear mass allocation). Passed to
  // `aggregateProductionRuns`, where it scopes ONLY stored/delivery-bucket
  // quantities + chemistry weights — production-bucket inputs sum full run
  // totals (§8.6.2 front-loading, issue #349, ADR 0020).
  attributionByRunId: Map<string, number>;
  // §8.6.2 per-member-batch production-bucket claim state (issue #349) —
  // drives the submit-path foreign-claim assertion and the claim write. The
  // sorted lineage arrays are the fingerprint the post-claim fresh re-assert
  // compares to a fresh scope read, failing closed when membership or run
  // lineage drifted between context load and the draft claim (ADR 0020).
  memberBatchClaims: {
    creditBatchId: string;
    code: string;
    claimedByRemovalId: string | null;
    productionRunIds: string[];
    applicationIds: string[];
  }[];
  // Transport legs pooled across every member batch's lineage, deduped by
  // entity id. Fed to `enrichWithTransportLegs` by the submit pipeline.
  transportLegs: TransportLegsByCategory;
  // The facility's resolved reference soil temperature (declared value, 7 °C
  // floored, one decimal) submitted as the `biochar_soil` measurement for a
  // 200-year removal (Phase 2). Null when the facility has not configured one —
  // when there are credit batches to submit, that null is fail-closed via a
  // durability gate blocker, so the Phase-3 step can assume non-null here.
  facilityReferenceSoilTemperature: FacilityReferenceSoilTemperature | null;
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
  const mdWarn = aggregateTransportMassDistance;
  return {
    feedstock: {
      count: legs.feedstock.length,
      entityIds: entityIds.feedstockIds,
      legIds: legs.feedstock.map((leg) => leg.id),
      firstLegEntityId: legs.feedstock[0]?.entityId ?? null,
      aggregationWarning: mdWarn(legs.feedstock, "Feedstock").warning,
    },
    biochar: {
      count: legs.biochar.length,
      entityIds: entityIds.biocharProductIds,
      legIds: legs.biochar.map((leg) => leg.id),
      firstLegEntityId: legs.biochar[0]?.entityId ?? null,
      aggregationWarning: mdWarn(legs.biochar, "Biochar").warning,
    },
    sample: {
      count: legs.sample.length,
      entityIds: entityIds.sampleIds,
      legIds: legs.sample.map((leg) => leg.id),
      firstLegEntityId: legs.sample[0]?.entityId ?? null,
      aggregationWarning: mdWarn(legs.sample, "Sample").warning,
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
  memberBatches: (MemberCreditBatch & {
    productionRunIds: string[];
    applicationIds: string[];
    durabilityOption: DurabilityOption;
    // §8.6.2 production-bucket claim state (issue #349, ADR 0020): the removal
    // that already claimed this batch's production emissions, or null.
    productionEmissionsClaimedByRemovalId: string | null;
  })[];
  lineages: ChainOfCustodyData[];
}

// Resolves the removal scope for a credit batch. When the batch is already
// grouped, the scope is every member of that removal; otherwise it is the
// batch alone (a 1:1 removal that will be created lazily on submit).
async function resolveScopeForCreditBatch(
  orgCtx: OrgContext,
  creditBatchId: string,
  options?: { singleBatch?: boolean },
): Promise<RemovalScope> {
  if (!options?.singleBatch) {
    const removalId = await getCreditBatchRemovalId(orgCtx, creditBatchId);
    if (removalId) {
      return resolveScopeForRemoval(orgCtx, removalId);
    }
  }

  const accounting = (
    await loadCreditBatchRollups(orgCtx, [creditBatchId])
  )[creditBatchId];
  if (!accounting) throw new SafeError("Credit batch not found");

  if (!options?.singleBatch && accounting.batch.removalId) {
    return resolveScopeForRemoval(orgCtx, accounting.batch.removalId);
  }

  return resolveSingleBatchScope(accounting);
}

function resolveSingleBatchScope(
  accounting: CreditBatchRollup,
): RemovalScope {
  const { batch, lineageFacts } = accounting;
  const runById = new Map(
    lineageFacts.runs.map((run) => [run.id, run]),
  );
  return {
    facilityId: batch.facilityId,
    removalId: null,
    removal: null,
    memberBatches: [
      {
        ...toMemberCreditBatch(accounting),
        productionRunIds: lineageFacts.productionRunIds,
        applicationIds: lineageFacts.applicationIds,
        durabilityOption: batch.durabilityOption,
        productionEmissionsClaimedByRemovalId:
          batch.productionEmissionsClaimedByRemovalId,
      },
    ],
    lineages: lineageFacts.applications.map((application) =>
      projectChainOfCustodyFromBatchFacts(
        application,
        runById.get(application.biocharProduct.linkedProductionRunId),
      ),
    ),
  };
}

// Resolves the removal scope from a removal id — every member credit batch.
export async function resolveScopeForRemoval(
  orgCtx: OrgContext,
  removalId: string,
): Promise<RemovalScope> {
  const removal = await getCertifierRemovalById(orgCtx, removalId);
  if (!removal) throw new SafeError("Removal not found");

  const batches = await getCreditBatchesByRemovalId(orgCtx, removalId);
  const batchIds = batches.map((batch) => batch.id);
  const accountingByBatch = await loadCreditBatchRollups(orgCtx, batchIds);
  const memberBatches = batches.map((batch) => {
      const accounting = accountingByBatch[batch.id];
      if (!accounting) {
        throw new SafeError(`Credit batch ${batch.id} could not be loaded`);
      }
      const { lineageFacts, batch: accountingBatch } = accounting;
      return {
        ...toMemberCreditBatch(accounting),
        productionRunIds: lineageFacts.productionRunIds,
        applicationIds: lineageFacts.applicationIds,
        durabilityOption: accountingBatch.durabilityOption,
        productionEmissionsClaimedByRemovalId:
          accountingBatch.productionEmissionsClaimedByRemovalId,
      };
    });
  const lineages = Object.values(accountingByBatch).flatMap((accounting) => {
    const { lineageFacts } = accounting;
    const runById = new Map(
      lineageFacts.runs.map((run) => [run.id, run]),
    );
    return lineageFacts.applications.map((application) =>
      projectChainOfCustodyFromBatchFacts(
        application,
        runById.get(application.biocharProduct.linkedProductionRunId),
      ),
    );
  });
  return {
    facilityId: removal.facilityId,
    removalId,
    removal,
    memberBatches,
    lineages: Array.from(new Map(lineages.map((lineage) => [lineage.application.id, lineage])).values()),
  };
}

// The facility-scoped half of a removal's submission context: the Isometric
// mapping + (when it resolves cleanly) the project / default template /
// referenced component blueprints, and the transport categories that template
// requires. These depend only on the facility, so the Overview work queue
// resolves them ONCE and feeds them to every removal's `buildRemovalContext`
// instead of re-pulling the same template/blueprint data per row.
export interface FacilityCertifierFacts {
  hasOrgCredentials: boolean;
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  defaultTemplate: IsometricGhgEntryTemplate | null;
  missingDefaultTemplateId: string | null;
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  requiredTransportCategories: TransportCategory[];
}

// Template-dependent fields shared by each unresolved short-circuit.
const UNRESOLVED_FACILITY_FACTS: Omit<
  FacilityCertifierFacts,
  "hasOrgCredentials" | "mapping" | "project"
> = {
  defaultTemplate: null,
  missingDefaultTemplateId: null,
  blueprintsForTemplate: [],
  unresolvedBlueprintKeys: [],
  requiredTransportCategories: [],
};

// Resolves the mapping, credentials, remote project/template, and referenced
// blueprints once per facility. Unresolved prerequisites skip downstream calls.
export async function loadFacilityCertifierFacts(
  orgCtx: OrgContext,
  facilityId: string,
): Promise<FacilityCertifierFacts> {
  const [mapping, hasOrgCredentials] = await Promise.all([
    getCertifierProjectByFacility(orgCtx, facilityId, ISOMETRIC_PROVIDER),
    hasCertifierCredentials(orgCtx, ISOMETRIC_PROVIDER),
  ]);
  if (!mapping) {
    return { hasOrgCredentials, mapping: null, project: null, ...UNRESOLVED_FACILITY_FACTS };
  }
  if (!hasOrgCredentials) {
    return { hasOrgCredentials: false, mapping, project: null, ...UNRESOLVED_FACILITY_FACTS };
  }
  // Avoid remote registry dependency until a template id exists to resolve.
  if (!mapping.defaultRemovalTemplateId) {
    return {
      hasOrgCredentials,
      mapping,
      project: null,
      ...UNRESOLVED_FACILITY_FACTS,
    };
  }

  const client = await getIsometricClientForOrg(orgCtx.organizationId);

  const [projects, templates] = await Promise.all([
    safeListIfConfigured(() => listProjects(client)),
    safeListIfConfigured(() => listGhgEntryTemplates(client, mapping.externalProjectId)),
  ]);
  const project =
    projects.find((p) => p.id === mapping.externalProjectId) ?? null;

  const defaultTemplate =
    templates.find((t) => t.id === mapping.defaultRemovalTemplateId) ?? null;
  if (!defaultTemplate) {
    return {
      hasOrgCredentials,
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
    listComponentBlueprints(client),
  );
  const blueprintByKey = new Map(allBlueprints.map((bp) => [bp.key, bp]));
  const blueprintsForTemplate: IsometricComponentBlueprint[] = [];
  const unresolvedBlueprintKeys: string[] = [];
  for (const key of referencedKeys) {
    const found = blueprintByKey.get(key);
    if (found) blueprintsForTemplate.push(found);
    // Explicit bindings are the fail-closed source of truth for template
    // components intentionally absent from the global blueprint catalogue.
    else if (!hasExplicitSequestrationBinding(key)) {
      unresolvedBlueprintKeys.push(key);
    }
  }

  return {
    hasOrgCredentials,
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

// Composes one removal's scope, submission, lineage, transport, and mass facts.
export async function buildRemovalContext(
  orgCtx: OrgContext,
  scope: RemovalScope,
  facilityFacts: FacilityCertifierFacts,
): Promise<RemovalSubmissionContext> {
  const isProduction = env.ISOMETRIC_ENVIRONMENT === "production";
  const memberBatches: MemberCreditBatch[] =
    scope.memberBatches.map(toMemberCreditBatchView);
  // §8.6.2 claim state per member batch (issue #349) — kept off
  // `MemberCreditBatch` (UI-facing) and carried only on the submission context.
  // Lineage arrays sorted here so the post-claim fresh re-assert compares
  // order-insensitively.
  const memberBatchClaims = scope.memberBatches.map((b) => ({
    creditBatchId: b.id,
    code: b.code,
    claimedByRemovalId: b.productionEmissionsClaimedByRemovalId,
    productionRunIds: [...b.productionRunIds].sort(),
    applicationIds: [...b.applicationIds].sort(),
  }));

  // Load removal-owned facts up-front so every short-circuit carries them.
  const [latestSubmission, linkedGhgStatement, supportingDocuments] =
    await Promise.all([
      scope.removalId
        ? getLatestSubmission(orgCtx, {
            provider: ISOMETRIC_PROVIDER,
            submissionType: REMOVAL_SUBMISSION_TYPE,
            localEntityType: REMOVAL_ENTITY_TYPE,
            localEntityId: scope.removalId,
          })
        : Promise.resolve(null),
      loadLinkedGhgStatementStatus(orgCtx, scope.removal),
      loadEvidenceMirrorSummaryForScope(orgCtx, scope),
    ]);

  // Walk every member batch's production-run applications into one deduped run union.
  const applicationIds = Array.from(
    new Set(scope.memberBatches.flatMap((b) => b.applicationIds)),
  );
  const lineages = scope.lineages;
  const runIds = Array.from(
    new Set(
      lineages
        .map((l) => l.productionRun?.id)
        .filter((id): id is string => !!id),
    ),
  );
  // Sample completeness is batch evidence, independent of application
  // lineage. Evaluate it before the no-application return so callers see both
  // blockers instead of discovering chemistry only after production is fixed.
  const durabilityBatchData = await loadDurabilityBatchData(
    orgCtx,
    scope.memberBatches.map((b) => b.id),
    new Set(runIds),
  );
  const {
    batchesWithSamples,
    blockers: durabilityBatchBlockers,
    warnings: durabilityWarnings,
  } = durabilityBatchData;
  const memberBatchesWithDurability = memberBatches.map((batch) => ({
    ...batch,
    durabilityGateBlockers:
      durabilityBatchData.blockersByBatchId[batch.id] ?? [],
  }));
  // The facility reference gates every 200-year member even before applications
  // exist; an empty site list deliberately suppresses site-comparison warnings.
  const facilityReferenceSoilTemperature =
    resolveFacilityReferenceSoilTemperature({
      declaredSoilTemperatureC: facilityFacts.mapping?.defaultSoilTemperatureC,
      source: facilityFacts.mapping?.defaultSoilTemperatureSource,
    });
  const soilTemperatureGate = buildSoilTemperatureGate({
    facilityReference: facilityReferenceSoilTemperature,
    batches: batchesWithSamples.map((batch) => ({
      durabilityOption: batch.durabilityOption,
      runIds: batch.runs.map((run) => run.id),
    })),
    siteTemperatures:
      applicationIds.length === 0
        ? []
        : lineages.map((l) => ({
            runId: l.productionRun?.id ?? null,
            soilTemperatureC: l.application.soilTemperatureC,
          })),
  });
  const durabilityGateBlockers = [
    ...durabilityBatchBlockers,
    ...soilTemperatureGate.blockers,
  ];
  const memberBatchesWithSubmissionGates = attributeSoilTemperatureBlockers(
    memberBatchesWithDurability,
    batchesWithSamples,
    soilTemperatureGate.blockers,
  );

  // Nothing to submit when the removal carries no applications. Facility
  // template setup does NOT gate the lineage walk; otherwise setup gaps collapse
  // into a misleading "no production data" blocker.
  if (applicationIds.length === 0) {
    const productionReadinessGap: ProductionReadinessGap = {
      kind: "noApplications",
      detail: scope.removalId
        ? "No applications linked to this Removal"
        : "No applications fall within this batch period.",
      fixTarget: "applications",
    };
    return {
      facilityId: scope.facilityId,
      removalId: scope.removalId,
      ...facilityFacts,
      memberBatches: memberBatchesWithSubmissionGates,
      transportCoverage: EMPTY_COVERAGE,
      hasSubmittableRuns: false,
      productionReadinessGap,
      entityReadinessGaps: [],
      durabilityGateBlockers,
      // No applications and no runs resolved ⇒ no date to be in the future.
      futureDatedMeasurements: [],
      submissionWarnings: [
        ...durabilityWarnings,
        ...soilTemperatureGate.warnings,
      ],
      supportingDocuments,
      runSummary: EMPTY_RUN_SUMMARY,
      latestSubmission,
      linkedGhgStatement,
      isProduction,
      lineages: [],
      runs: [],
      batchesWithSamples,
      attributionByRunId: new Map<string, number>(),
      memberBatchClaims,
      transportLegs: { feedstock: [], biochar: [], sample: [] },
      facilityReferenceSoilTemperature,
    };
  }

  const runs =
    runIds.length > 0
      ? await getProductionRunsWithSamples(orgCtx, runIds)
      : [];
  const productionReadinessGap = productionReadinessGapFromLineages(lineages);

  // Credit-batch-grained durability data plane (ADR 0016): pool each member
  // batch's lab Samples, scope runs to the removal's applied set, and run the D3
  // gates. Loaded BEFORE the transport walk — samples anchor on the batch
  // (issue #309), so the sample transport legs and per-sample readiness gaps
  // hang off these pooled samples, not off the runs. `durabilityGateBlockers`
  // is the same fail-closed list the submit pipeline blocks on; the §8.3.1
  // distribution warning is advisory, so it joins the non-blocking submission
  // warnings.
  const entityIds = collectTransportEntityIds(lineages, batchesWithSamples);
  const transportLegs = await loadTransportLegsByCategory(orgCtx, entityIds);
  const transportCoverage = buildCoverage(transportLegs, entityIds);
  const entityReadiness = await buildCertifyEntityReadiness({
    orgCtx,
    lineages,
    runs,
    batchesWithSamples,
    transportLegs,
    requiredTransportCategories: facilityFacts.requiredTransportCategories,
  });
  // One mass-accounting walk: the per-run attribution the submit pipeline
  // scopes by AND the Review-flow summary, so the two can never diverge.
  const { attributionByRunId, runSummary } = buildMassAccounting(
    lineages,
    runs,
  );

  const submissionWarnings = [
    ...buildSubmissionWarnings({
      defaultTemplate: facilityFacts.defaultTemplate,
      runs,
      lineages,
    }),
    ...entityReadiness.warnings,
    ...durabilityWarnings,
    ...soilTemperatureGate.warnings,
  ];

  return {
    facilityId: scope.facilityId,
    removalId: scope.removalId,
    ...facilityFacts,
    memberBatches: memberBatchesWithSubmissionGates,
    transportCoverage,
    hasSubmittableRuns: runs.length > 0 && !productionReadinessGap,
    productionReadinessGap,
    entityReadinessGaps: entityReadiness.gaps,
    entityReadinessIssues: entityReadiness.issues,
    durabilityGateBlockers,
    futureDatedMeasurements: collectFutureDatedMeasurements({ runs, lineages }),
    submissionWarnings,
    supportingDocuments,
    runSummary,
    latestSubmission,
    linkedGhgStatement,
    isProduction,
    lineages,
    runs,
    batchesWithSamples,
    attributionByRunId,
    memberBatchClaims,
    transportLegs,
    facilityReferenceSoilTemperature,
  };
}

// Submission-pipeline context keyed by removal id — used by `submitRemoval`.
// Resolves the scope, then the facility facts for that scope's facility, then
// composes; the Overview queue reuses `buildRemovalContext` with facility facts
// loaded once across all of a facility's removals.
export async function loadRemovalSubmissionContext(
  orgCtx: OrgContext,
  removalId: string,
): Promise<RemovalSubmissionContext> {
  const scope = await resolveScopeForRemoval(orgCtx, removalId);
  const facilityFacts = await loadFacilityCertifierFacts(
    orgCtx,
    scope.facilityId,
  );
  return buildRemovalContext(orgCtx, scope, facilityFacts);
}

function projectUiContext(
  ctx: RemovalSubmissionContext,
): RemovalCertifyContext {
  return {
    facilityId: ctx.facilityId,
    hasOrgCredentials: ctx.hasOrgCredentials,
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
    entityReadinessIssues: ctx.entityReadinessIssues ?? [],
    durabilityGateBlockers: ctx.durabilityGateBlockers,
    futureDatedMeasurements: ctx.futureDatedMeasurements,
    submissionWarnings: ctx.submissionWarnings,
    supportingDocuments: ctx.supportingDocuments,
    runSummary: ctx.runSummary,
    latestSubmission: ctx.latestSubmission,
    linkedGhgStatement: ctx.linkedGhgStatement,
    isProduction: ctx.isProduction,
  };
}

// Guided Review UI context keyed by removal id; its pre-flight runs the shared
// `deriveRemovalReadiness` classifier against it). Mirrors
// `loadCertifyContextForCreditBatch` but resolves the scope from the removal.
export async function loadRemovalCertifyContext(
  facilityId: string,
  removalId: string,
): Promise<ActionResult<RemovalCertifyContext>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const removal = await getCertifierRemovalById(orgCtx, removalId);
    if (!removal || removal.facilityId !== facilityId) {
      throw new SafeError("Removal does not belong to requested facility");
    }
    return projectUiContext(
      await loadRemovalSubmissionContext(orgCtx, removalId),
    );
  });
}

export async function loadCertifyContextForCreditBatchForUser(
  orgCtx: OrgContext,
  creditBatchId: string,
  options?: { singleBatch?: boolean },
): Promise<RemovalCertifyContext> {
  const scope = await resolveScopeForCreditBatch(orgCtx, creditBatchId, options);
  const facilityFacts = await loadFacilityCertifierFacts(
    orgCtx,
    scope.facilityId,
  );
  return projectUiContext(
    await buildRemovalContext(orgCtx, scope, facilityFacts),
  );
}
export async function loadCertifyContextForCreditBatch(
  creditBatchId: string,
): Promise<ActionResult<RemovalCertifyContext>> {
  return withAction(async (orgCtx) =>
    loadCertifyContextForCreditBatchForUser(orgCtx, creditBatchId),
  );
}
export interface CreditBatchContextSet {
  accountingByBatch: CreditBatchRollupsByBatch;
  contextsByBatch: Record<string, RemovalCertifyContext>;
}

// Multi-batch wizard seam: one set accounting load, then bounded context
// composition from those complete records. No caller can inject lineage facts.
export async function buildCreditBatchContexts(
  orgCtx: OrgContext,
  creditBatchIds: string[],
  facilityFacts: FacilityCertifierFacts,
): Promise<CreditBatchContextSet> {
  const accountingByBatch = await loadCreditBatchRollups(
    orgCtx,
    creditBatchIds,
  );
  const contextEntries: Array<
    readonly [string, RemovalCertifyContext]
  > = [];
  for (
    let index = 0;
    index < creditBatchIds.length;
    index += FANOUT_CONCURRENCY
  ) {
    const chunk = await Promise.all(
      creditBatchIds
        .slice(index, index + FANOUT_CONCURRENCY)
        .map(async (creditBatchId) => {
          const accounting = accountingByBatch[creditBatchId];
          if (!accounting) {
            throw new SafeError(
              `Credit batch ${creditBatchId} could not be loaded`,
            );
          }
          const context = await buildRemovalContext(
            orgCtx,
            resolveSingleBatchScope(accounting),
            facilityFacts,
          );
          return [creditBatchId, projectUiContext(context)] as const;
        }),
    );
    contextEntries.push(...chunk);
  }
  return {
    accountingByBatch,
    contextsByBatch: Object.fromEntries(contextEntries),
  };
}

export interface RemovalHubEntry {
  removal: CertifierRemovalRow;
  memberBatches: Pick<MemberCreditBatch, "id" | "code">[];
  latestSubmission: CertificationSubmissionRow | null;
}

export interface RemovalsHubData {
  removals: RemovalHubEntry[];
  ungroupedBatches: UngroupedCreditBatchRow[];
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
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const [removalRows, ungroupedBatches] = await Promise.all([
      listRemovalsForFacility(orgCtx, facilityId),
      listUngroupedCreditBatches(orgCtx, facilityId),
    ]);
    // Bounded chunks (order-preserving) rather than one unbounded Promise.all
    // over every removal — see FANOUT_CONCURRENCY.
    const removals: RemovalHubEntry[] = [];
    for (let i = 0; i < removalRows.length; i += FANOUT_CONCURRENCY) {
      const chunk = await Promise.all(
        removalRows.slice(i, i + FANOUT_CONCURRENCY).map(async (removal) => {
          const [batches, latestSubmission] = await Promise.all([
            getCreditBatchesByRemovalId(orgCtx, removal.id),
            getLatestSubmission(orgCtx, {
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

// Selection-step payload for the New-Removal wizard: every ungrouped credit
// batch in the facility paired with the SAME health verdict the credit-batch
// detail page shows. Facility authorization and certifier facts stay in the
// core action; the cohesive selectable-batch read flow lives in its split.
export async function loadSelectableBatchesForFacility(
  facilityId: string,
): Promise<ActionResult<SelectableBatchesData>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const facilityFacts = await loadFacilityCertifierFacts(orgCtx, facilityId);
    return buildSelectableBatchesData(
      orgCtx,
      facilityId,
      facilityFacts,
      buildCreditBatchContexts,
    );
  });
}
