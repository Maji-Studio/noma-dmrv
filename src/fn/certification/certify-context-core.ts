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
  type BatchLineageRunFact,
  type CreditBatchRollup,
  type CreditBatchRollupsByBatch,
} from "@/data-access/credit-batch-accounting";
import { getCreditBatchActiveScopeRemovalId } from "@/data-access/credit-batches";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
import {
  buildMassAccounting,
  EMPTY_RUN_SUMMARY,
  type RemovalRunSummary,
} from "@/lib/certification/mass-accounting";
import type { ProductionReadinessGap } from "@/lib/certification/production-readiness";
import {
  collectFeedstockTypeMappingGaps,
  type FeedstockTypeMappingGap,
} from "@/lib/certification/feedstock-type-mapping";
import { attributeSoilTemperatureBlockers } from "@/lib/certification/member-batch-gates";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { SafeError } from "@/lib/errors";
import {
  getIsometricClientForOrg,
  listComponentBlueprints,
  listProjects,
  listGhgEntryTemplates,
  type IsometricComponentBlueprint,
  type IsometricProject,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
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
import { productionReadinessGapForScope } from "@/lib/certification/production-readiness-from-lineage";
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
import { collectProductionClaimAwareRequiredTransportCategories, collectProductionClaimAwareTransportEntityIds } from "./production-claim-transport-scope";
import { includesProductionInputs } from "./production-claim-policy";
import { summarizeApplicationSlices } from "./application-slice-summary";
import { buildRemovalLedgerPreview, type RemovalLedgerPreview } from "./removal-ledger-preview";
import {
  buildTransportCoverage,
  deriveRequiredTransportCategories,
  EMPTY_TRANSPORT_COVERAGE,
  type TransportCategory,
  type TransportCoverage,
} from "./certify-transport-coverage";
export type { LinkedGhgStatementStatus } from "./linked-ghg-statement-status";
export type { SelectableBatch, SelectableBatchesData } from "./selectable-batches";
export type { MemberCreditBatch } from "./member-credit-batch";

// Bound facility fan-out so per-removal DB/registry query chains cannot burst
// the connection pool. Mirrors `READINESS_CONCURRENCY` in overview.ts.
const FANOUT_CONCURRENCY = 8;
export type {
  TransportCategory,
  TransportCoverage,
  TransportCoverageBucket,
} from "./certify-transport-coverage";

type DurabilityOption = "200_year" | "1000_year";
// UI-facing removal context — the lean payload React Query caches.
export interface RemovalCertifyContext {
  facilityId: string;
  hasOrgCredentials: boolean;
  // Null when the credit batch is not yet grouped into a removal (a 1:1
  // removal is created lazily on first submit).
  removalId: string | null;
  // Persisted §8.6.2 registry reporting window for this Removal.
  reportingWindowStartedOn: string | null;
  reportingWindowCompletedOn: string | null;
  mapping: CertifierProjectRow | null;
  project: IsometricProject | null;
  defaultTemplate: IsometricGhgEntryTemplate | null;
  missingDefaultTemplateId: string | null;
  blueprintsForTemplate: IsometricComponentBlueprint[];
  unresolvedBlueprintKeys: string[];
  memberBatches: MemberCreditBatch[];
  emissionsLedger: RemovalLedgerPreview;
  feedstockTypeMappingGaps: FeedstockTypeMappingGap[];
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
export interface RemovalSubmissionContext extends Omit<RemovalCertifyContext, "emissionsLedger"> {
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
    durabilityOption: DurabilityOption;
    claimedByRemovalId: string | null;
    productionRunIds: string[];
    applicationIds: string[];
    applicationSlices?: {
      applicationId: string;
      allocatedWetMassKg: number;
      allocatedDryMassKg: number;
    }[];
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


// The set of credit batches that compose one removal, with their facility.
interface RemovalScope {
  facilityId: string;
  removalId: string | null;
  removal: CertifierRemovalRow | null;
  memberBatches: (MemberCreditBatch & {
    productionRunIds: string[];
    // Member runs with status "complete" — drives the readiness routing between
    // "complete a run" and "review the application chain" when nothing is
    // submittable. Membership writes already reject non-complete runs and block
    // reopening a member run, so this filter is defensive (legacy rows, future
    // membership paths); it also keeps the routing honest with the gap copy's
    // "completed" claim.
    completedProductionRunIds: string[];
    productionFeedstockIds: string[];
    applicationIds: string[];
    applicationSlices: {
      applicationId: string;
      allocatedWetMassKg: number;
      allocatedDryMassKg: number;
    }[];
    durabilityOption: DurabilityOption;
    // §8.6.2 production-bucket claim state (issue #349, ADR 0020): the removal
    // that already claimed this batch's production emissions, or null.
    productionEmissionsClaimedByRemovalId: string | null;
  })[];
  lineages: ChainOfCustodyData[];
}

function completedRunIds(runs: BatchLineageRunFact[]): string[] {
  return runs
    .filter((run) => run.status === COMPLETED_PRODUCTION_RUN_STATUS)
    .map((run) => run.id);
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
    const removalId = await getCreditBatchActiveScopeRemovalId(
      orgCtx,
      creditBatchId,
    );
    if (removalId) {
      return resolveScopeForRemoval(orgCtx, removalId);
    }
  }

  const accounting = (
    await loadCreditBatchRollups(orgCtx, [creditBatchId], {
      unassignedOnly: !options?.singleBatch,
    })
  )[creditBatchId];
  if (!options?.singleBatch) {
    const racedRemovalId = await getCreditBatchActiveScopeRemovalId(
      orgCtx,
      creditBatchId,
    );
    if (racedRemovalId) return resolveScopeForRemoval(orgCtx, racedRemovalId);
  }
  if (!accounting) throw new SafeError("Credit batch not found");

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
        completedProductionRunIds: completedRunIds(lineageFacts.runs),
        productionFeedstockIds: Array.from(
          new Set(
            lineageFacts.runs.flatMap((run) =>
              run.feedstocks.map((feedstock) => feedstock.id),
            ),
          ),
        ),
        applicationIds: lineageFacts.applicationIds,
        applicationSlices: summarizeApplicationSlices(lineageFacts.applications),
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
  const accountingByBatch = await loadCreditBatchRollups(orgCtx, batchIds, {
    removalId,
  });
  const memberBatches = batches.map((batch) => {
      const accounting = accountingByBatch[batch.id];
      if (!accounting) {
        throw new SafeError(`Credit batch ${batch.id} could not be loaded`);
      }
      const { lineageFacts, batch: accountingBatch } = accounting;
      return {
        ...toMemberCreditBatch(accounting),
        productionRunIds: lineageFacts.productionRunIds,
        completedProductionRunIds: completedRunIds(lineageFacts.runs),
        productionFeedstockIds: Array.from(
          new Set(
            lineageFacts.runs.flatMap((run) =>
              run.feedstocks.map((feedstock) => feedstock.id),
            ),
          ),
        ),
        applicationIds: lineageFacts.applicationIds,
        applicationSlices: summarizeApplicationSlices(lineageFacts.applications),
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
    lineages: [
      ...new Map(
        lineages.map((lineage) => [
          `${lineage.application.id}:${lineage.productionRun?.id ?? "missing"}`,
          lineage,
        ]),
      ).values(),
    ],
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

// Composes one removal's scope, submission, lineage, transport, and mass facts.
export async function buildRemovalContext(
  orgCtx: OrgContext,
  scope: RemovalScope,
  facilityFacts: FacilityCertifierFacts,
): Promise<RemovalSubmissionContext> {
  const isProduction = env.ISOMETRIC_ENVIRONMENT === "production";
  const memberBatches: MemberCreditBatch[] =
    scope.memberBatches.map(toMemberCreditBatchView);
  const feedstockTypeMappingGaps =
    facilityFacts.mapping &&
    facilityFacts.defaultTemplate &&
    !facilityFacts.missingDefaultTemplateId &&
    facilityFacts.unresolvedBlueprintKeys.length === 0
      ? collectFeedstockTypeMappingGaps(memberBatches)
      : [];
  // §8.6.2 claim state per member batch (issue #349) — kept off
  // `MemberCreditBatch` (UI-facing) and carried only on the submission context.
  // Lineage arrays sorted here so the post-claim fresh re-assert compares
  // order-insensitively.
  const memberBatchClaims = scope.memberBatches.map((b) => ({
    creditBatchId: b.id,
    code: b.code,
    durabilityOption: b.durabilityOption,
    claimedByRemovalId: b.productionEmissionsClaimedByRemovalId,
    productionRunIds: [...b.productionRunIds].sort(),
    applicationIds: [...b.applicationIds].sort(),
    applicationSlices: b.applicationSlices,
  }));

  // Load removal-owned facts up-front so every short-circuit carries them.
  const [latestSubmission, linkedGhgStatement] = await Promise.all([
      scope.removalId
        ? getLatestSubmission(orgCtx, {
            provider: ISOMETRIC_PROVIDER,
            submissionType: REMOVAL_SUBMISSION_TYPE,
            localEntityType: REMOVAL_ENTITY_TYPE,
            localEntityId: scope.removalId,
          })
        : Promise.resolve(null),
      loadLinkedGhgStatementStatus(orgCtx, scope.removal),
    ]);
  const supportingDocuments = await loadEvidenceMirrorSummaryForScope(
    orgCtx,
    scope,
    latestSubmission,
  );

  // Walk every member batch's production-run applications into one deduped run union.
  const applicationIds = Array.from(
    new Set(scope.memberBatches.flatMap((b) => b.applicationIds)),
  );
  const lineages = scope.lineages;
  const productionReadinessGap = productionReadinessGapForScope({
    lineages,
    completedMemberProductionRunIds: scope.memberBatches.flatMap(
      (batch) => batch.completedProductionRunIds,
    ),
    scope: scope.removalId ? "removal" : "creditBatch",
  });
  const appliedRunIds = Array.from(
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
    new Set(appliedRunIds),
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
    return {
      facilityId: scope.facilityId,
      removalId: scope.removalId,
      reportingWindowStartedOn: scope.removal?.startedOn ?? null,
      reportingWindowCompletedOn: scope.removal?.completedOn ?? null,
      ...facilityFacts,
      memberBatches: memberBatchesWithSubmissionGates,
      feedstockTypeMappingGaps,
      transportCoverage: EMPTY_TRANSPORT_COVERAGE,
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

  // Stored and delivery quantities remain application-scoped, but the first
  // Removal to claim a credit batch must carry every member run's production
  // inputs, including runs whose biochar has not yet been applied. Load that
  // whole production union; buildMassAccounting assigns unapplied runs a zero
  // stored-mass factor.
  const productionClaimRunIds = scope.memberBatches
    .filter((batch) =>
      includesProductionInputs(
        batch.productionEmissionsClaimedByRemovalId,
        scope.removalId,
      ),
    )
    .flatMap((batch) => batch.productionRunIds);
  const runIds = Array.from(
    new Set([...appliedRunIds, ...productionClaimRunIds]),
  );
  const runs =
    runIds.length > 0
      ? await getProductionRunsWithSamples(orgCtx, runIds)
      : [];

  // Batch-pooled Samples drive durability, transport, and readiness (ADR 0016).
  // The same durability blockers gate the submit pipeline below.
  const entityIds = collectProductionClaimAwareTransportEntityIds({
    removalId: scope.removalId,
    memberBatches: scope.memberBatches,
    lineages,
    batchesWithSamples,
  });
  const requiredTransportCategories = collectProductionClaimAwareRequiredTransportCategories({
    removalId: scope.removalId,
    memberBatches: scope.memberBatches,
    requiredTransportCategories: facilityFacts.requiredTransportCategories,
  });
  const transportLegs = await loadTransportLegsByCategory(orgCtx, entityIds);
  const transportCoverage = buildTransportCoverage(transportLegs, entityIds);
  const entityReadiness = await buildCertifyEntityReadiness({
    runs,
    batchesWithSamples,
    transportLegs,
    requiredTransportCategories,
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
    reportingWindowStartedOn: scope.removal?.startedOn ?? null,
    reportingWindowCompletedOn: scope.removal?.completedOn ?? null,
    ...facilityFacts,
    requiredTransportCategories,
    memberBatches: memberBatchesWithSubmissionGates,
    feedstockTypeMappingGaps,
    transportCoverage,
    hasSubmittableRuns: runs.length > 0 && !productionReadinessGap,
    productionReadinessGap,
    entityReadinessGaps: entityReadiness.gaps,
    entityReadinessIssues: entityReadiness.issues,
    durabilityGateBlockers,
    futureDatedMeasurements: collectFutureDatedMeasurements({
      runs,
      samples: batchesWithSamples.flatMap((batch) => batch.samples),
      lineages,
    }),
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
    reportingWindowStartedOn: ctx.reportingWindowStartedOn,
    reportingWindowCompletedOn: ctx.reportingWindowCompletedOn,
    mapping: ctx.mapping,
    project: ctx.project,
    defaultTemplate: ctx.defaultTemplate,
    missingDefaultTemplateId: ctx.missingDefaultTemplateId,
    blueprintsForTemplate: ctx.blueprintsForTemplate,
    unresolvedBlueprintKeys: ctx.unresolvedBlueprintKeys,
    memberBatches: ctx.memberBatches,
    emissionsLedger: buildRemovalLedgerPreview(ctx),
    feedstockTypeMappingGaps: ctx.feedstockTypeMappingGaps,
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
  options?: { unassignedOnly?: boolean },
): Promise<CreditBatchContextSet> {
  const accountingByBatch = options?.unassignedOnly
    ? await loadCreditBatchRollups(orgCtx, creditBatchIds, {
        unassignedOnly: true,
      })
    : await loadCreditBatchRollups(orgCtx, creditBatchIds);
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

// Removals hub payload for a facility: every Removal with its member credit
// batches and latest submission, plus newly applied mass not yet grouped.
export async function loadRemovalsForFacility(
  facilityId: string,
): Promise<ActionResult<RemovalsHubData>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const [removalRows, ungroupedBatches] = await Promise.all([
      listRemovalsForFacility(orgCtx, facilityId),
      listUngroupedCreditBatches(orgCtx, facilityId),
    ]);
    // Bounded chunks preserve order without bursting the connection pool.
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

// New-Removal selection payload. Each ungrouped batch carries the same health
// verdict used by credit-batch detail.
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
