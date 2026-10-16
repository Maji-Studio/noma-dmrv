import { TRANSPORT_CATEGORIES } from "@/lib/isometric/semantic-binding-catalog";
import { resolveScopeForCreditBatch, resolveSingleBatchScope, resolveScopeForRemoval, type RemovalScope } from "./removal-scope";
import { loadFacilityCertifierFacts, type FacilityCertifierFacts } from "./facility-certifier-facts";
import { buildSubmissionLineageBlockers } from "./certify-lineage-blockers";
import { hasDurabilityMeasurementComponents, durabilityConfigurationBlockers } from "@/lib/certification/submission-readiness";
import type { OrgContext } from "@/lib/auth/server";
import { env } from "@/config/env";
import { requireOrgFacility } from "@/data-access/utils";
import {
  getLatestSubmission,
  hasFinalizedSubmission,
} from "@/data-access/certification-submissions";
import { removalMayHaveExternalMutation } from "@/lib/certification/removal-external-mutation";
import {
  getCertifierRemovalById,
} from "@/data-access/certifier-removals";
import {
  loadCreditBatchRollups,
  type CreditBatchRollupsByBatch,
} from "@/data-access/credit-batch-accounting";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import {
  buildMassAccounting,
  EMPTY_RUN_SUMMARY,
} from "@/lib/certification/mass-accounting";
import {
  collectFeedstockTypeMappingGaps,
} from "@/lib/certification/feedstock-type-mapping";
import { attributeSoilTemperatureBlockers } from "@/lib/certification/member-batch-gates";
import { SafeError } from "@/lib/errors";
import {
  buildSoilTemperatureGate,
  resolveFacilityReferenceSoilTemperature,
} from "@/lib/isometric/utils/durability-aggregation";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
  loadTransportLegsByCategory,
} from "./shared";
import { buildCertifyEntityReadiness } from "./certify-entity-readiness";
import { loadDurabilityBatchData } from "./durability-readiness";
import { collectFutureDatedMeasurements } from "./future-dated-measurements";
import { buildSubmissionWarnings } from "./submission-warnings";
import { productionReadinessGapForScope } from "@/lib/certification/production-readiness-from-lineage";
import { loadEvidenceMirrorSummaryForScope } from "./evidence-mirror-summary";
import {
  loadLinkedGhgStatementStatus,
} from "./linked-ghg-statement-status";
import {
  buildSelectableBatchesData,
  type SelectableBatchesData,
} from "./selectable-batches";
import {
  toMemberCreditBatchView,
  type MemberCreditBatch,
} from "./member-credit-batch";
import { collectProductionClaimAwareRequiredTransportCategories, collectProductionClaimAwareTransportEntityIds } from "./production-claim-transport-scope";
import { includesProductionInputs } from "./production-claim-policy";
import { buildRemovalLedgerPreview } from "./removal-ledger-preview";
import {
  buildTransportCoverage,
  EMPTY_TRANSPORT_COVERAGE,
} from "./certify-transport-coverage";
export { resolveScopeForRemoval } from "./removal-scope";
export { loadFacilityCertifierFacts, type FacilityCertifierFacts } from "./facility-certifier-facts";
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

import { resolveRemovalTemplate } from "./resolve-removal-template";
import type { RemovalCertifyContext, RemovalSubmissionContext } from "./certify-context-types";
export type { RemovalCertifyContext, RemovalSubmissionContext } from "./certify-context-types";

// Composes one removal's scope, submission, lineage, transport, and mass facts.
export async function buildRemovalContext(
  orgCtx: OrgContext,
  scope: RemovalScope,
  facilityFacts: FacilityCertifierFacts,
): Promise<RemovalSubmissionContext> {
  const templateFacts = resolveRemovalTemplate(scope.memberBatches, facilityFacts);
  const isProduction = env.ISOMETRIC_ENVIRONMENT === "production";
  const memberBatches: MemberCreditBatch[] =
    scope.memberBatches.map(toMemberCreditBatchView);
  const feedstockTypeMappingGaps =
    facilityFacts.mapping &&
    templateFacts.removalTemplate &&
    templateFacts.templateBlockers.length === 0 &&
    templateFacts.unresolvedBlueprintKeys.length === 0 &&
    templateFacts.unbindableTemplateInputs.length === 0
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
  const [latestSubmission, hasFinalized, linkedGhgStatement] =
    await Promise.all([
      scope.removalId
        ? getLatestSubmission(orgCtx, {
            provider: ISOMETRIC_PROVIDER,
            submissionType: REMOVAL_SUBMISSION_TYPE,
            localEntityType: REMOVAL_ENTITY_TYPE,
            localEntityId: scope.removalId,
          })
        : Promise.resolve(null),
      scope.removalId
        ? hasFinalizedSubmission(orgCtx, {
            provider: ISOMETRIC_PROVIDER,
            submissionType: REMOVAL_SUBMISSION_TYPE,
            localEntityType: REMOVAL_ENTITY_TYPE,
            localEntityId: scope.removalId,
          })
        : Promise.resolve(false),
      loadLinkedGhgStatementStatus(orgCtx, scope.removal),
    ]);
  const registryBoundaryOpened = removalMayHaveExternalMutation(
    scope.removal?.metadata ?? null,
  );
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
  const memberBatchesWithDurability = memberBatches.map((batch) => {
    const sampleBatch = batchesWithSamples.find((sampleBatch) => sampleBatch.creditBatchId === batch.id);
    return {
      ...batch,
      hasLabReport: sampleBatch?.hasLabReport,
      hasReflectanceHistogram: sampleBatch?.hasReflectanceHistogram,
      durabilityGateBlockers:
        durabilityBatchData.blockersByBatchId[batch.id] ?? [],
    };
  });
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
  const durabilityConfigBlockers = hasDurabilityMeasurementComponents(templateFacts.removalTemplate)
    ? durabilityConfigurationBlockers(batchesWithSamples) : [];
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
      hasOrgCredentials: facilityFacts.hasOrgCredentials,
      mapping: facilityFacts.mapping,
      project: facilityFacts.project,
      ...templateFacts,
      memberBatches: memberBatchesWithSubmissionGates,
      feedstockTypeMappingGaps,
      transportCoverage: EMPTY_TRANSPORT_COVERAGE,
      hasSubmittableRuns: false,
      productionReadinessGap,
      entityReadinessGaps: [],
      submissionLineageBlockers: [],
      durabilityGateBlockers,
      durabilityConfigurationBlockers: durabilityConfigBlockers,
      // No applications and no runs resolved ⇒ no date to be in the future.
      futureDatedMeasurements: [],
      submissionWarnings: [
        ...durabilityWarnings,
        ...soilTemperatureGate.warnings,
      ],
      supportingDocuments,
      runSummary: EMPTY_RUN_SUMMARY,
      latestSubmission,
      hasFinalizedSubmission: hasFinalized,
      registryBoundaryOpened,
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
      ? await getProductionRunsForCertification(orgCtx, runIds)
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
    requiredTransportCategories: templateFacts.requiredTransportCategories,
  });
  // Recorded facts must survive template drift for the dropped-source advisory.
  // Compilation still receives only required delivery transport, so an omitted
  // line cannot introduce unrelated route-completeness blockers.
  const recordedTransportLegs = await loadTransportLegsByCategory(orgCtx, entityIds, lineages, TRANSPORT_CATEGORIES);
  const transportLegs = {
    ...recordedTransportLegs,
    biochar: requiredTransportCategories.includes("biochar") ? recordedTransportLegs.biochar : [],
  };
  const transportCoverage = buildTransportCoverage(transportLegs, entityIds);
  const submissionLineageBlockers = buildSubmissionLineageBlockers(
    lineages,
    transportCoverage.feedstock.missingEntityIds ?? [],
    scope.feedstockCodes,
    requiredTransportCategories,
  );
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
      removalTemplate: templateFacts.removalTemplate,
      lineSources: templateFacts.lineSources,
      transportLegs: recordedTransportLegs,
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
    hasOrgCredentials: facilityFacts.hasOrgCredentials,
    mapping: facilityFacts.mapping,
    project: facilityFacts.project,
    ...templateFacts,
    requiredTransportCategories,
    memberBatches: memberBatchesWithSubmissionGates,
    feedstockTypeMappingGaps,
    transportCoverage,
    hasSubmittableRuns: runs.length > 0 && !productionReadinessGap,
    productionReadinessGap,
    entityReadinessGaps: entityReadiness.gaps,
    submissionLineageBlockers,
    entityReadinessIssues: entityReadiness.issues,
    durabilityGateBlockers,
    durabilityConfigurationBlockers: durabilityConfigBlockers,
    futureDatedMeasurements: collectFutureDatedMeasurements({
      runs,
      samples: batchesWithSamples.flatMap((batch) => batch.samples),
      lineages,
    }),
    submissionWarnings,
    supportingDocuments,
    runSummary,
    latestSubmission,
    hasFinalizedSubmission: hasFinalized,
    registryBoundaryOpened,
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
  options: { refreshEnrichment?: boolean } = {},
): Promise<RemovalSubmissionContext> {
  const scope = await resolveScopeForRemoval(orgCtx, removalId);
  const facilityFacts = await loadFacilityCertifierFacts(
    orgCtx,
    scope.facilityId,
    options,
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
    removalTemplate: ctx.removalTemplate,
    lineSources: ctx.lineSources,
    templateBlockers: ctx.templateBlockers,
    blueprintsForTemplate: ctx.blueprintsForTemplate,
    unresolvedBlueprintKeys: ctx.unresolvedBlueprintKeys,
    unbindableTemplateInputs: ctx.unbindableTemplateInputs,
    memberBatches: ctx.memberBatches,
    emissionsLedger: buildRemovalLedgerPreview(ctx),
    feedstockTypeMappingGaps: ctx.feedstockTypeMappingGaps,
    transportCoverage: ctx.transportCoverage,
    requiredTransportCategories: ctx.requiredTransportCategories,
    hasSubmittableRuns: ctx.hasSubmittableRuns,
    productionReadinessGap: ctx.productionReadinessGap,
    entityReadinessGaps: ctx.entityReadinessGaps,
    submissionLineageBlockers: ctx.submissionLineageBlockers,
    entityReadinessIssues: ctx.entityReadinessIssues ?? [],
    durabilityGateBlockers: ctx.durabilityGateBlockers,
    durabilityConfigurationBlockers: ctx.durabilityConfigurationBlockers,
    futureDatedMeasurements: ctx.futureDatedMeasurements,
    submissionWarnings: ctx.submissionWarnings,
    supportingDocuments: ctx.supportingDocuments,
    runSummary: ctx.runSummary,
    latestSubmission: ctx.latestSubmission,
    hasFinalizedSubmission: ctx.hasFinalizedSubmission,
    registryBoundaryOpened: ctx.registryBoundaryOpened,
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
