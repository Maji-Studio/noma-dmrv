import type { CoveredContenders } from "@/lib/certification/covered-contenders";
import { env } from "@/config/env";
import {
  getLatestSubmission,
  hasFinalizedSubmission,
} from "@/data-access/certification-submissions";
import type { loadFacilityEmissionEntryCarry } from "@/data-access/emission-entry-carry";
import { getProductionRunsForCertification } from "@/data-access/production-runs";
import { getRemovalCodes } from "@/data-access/removal-codes";
import { getTransportDistanceFixLinks } from "@/data-access/transport-distance-fix-links";
import type { OrgContext } from "@/lib/auth/server";
import {
  collectFeedstockTypeMappingGaps,
} from "@/lib/certification/feedstock-type-mapping";
import {
  buildMassAccounting,
  EMPTY_RUN_SUMMARY,
} from "@/lib/certification/mass-accounting";
import { attributeSoilTemperatureBlockers } from "@/lib/certification/member-batch-gates";
import { productionReadinessGapForScope } from "@/lib/certification/production-readiness-from-lineage";
import { hasFreshRemovalDeletionLease } from "@/lib/certification/removal-deletion-lease";
import { removalMayHaveExternalMutation } from "@/lib/certification/removal-external-mutation";
import { removalTemplateTierCompatibilityBlocker } from "@/lib/certification/removal-template-tier";
import { durabilityConfigurationBlockers, hasDurabilityMeasurementComponents } from "@/lib/certification/submission-readiness";
import { TRANSPORT_CATEGORIES } from "@/lib/isometric/semantic-binding-catalog";
import {
  buildSoilTemperatureGate,
  resolveFacilityReferenceSoilTemperature,
} from "@/lib/isometric/utils/durability-aggregation";
import { loadBatchEmissionContext, type BatchEmissionContextOptions } from "./batch-emission-context";
import { buildCertifyEntityReadiness } from "./certify-entity-readiness";
import { buildSubmissionLineageBlockers } from "./certify-lineage-blockers";
import {
  buildTransportCoverage,
  EMPTY_TRANSPORT_COVERAGE,
} from "./certify-transport-coverage";
import { loadDurabilityBatchData } from "./durability-readiness";
import { loadEvidenceMirrorSummaryForScope } from "./evidence-mirror-summary";
import { type FacilityCertifierFacts } from "./facility-certifier-facts";
import { collectFutureDatedMeasurements } from "./future-dated-measurements";
import {
  loadLinkedGhgStatementStatus,
} from "./linked-ghg-statement-status";
import {
  toMemberCreditBatchView,
  type MemberCreditBatch,
} from "./member-credit-batch";
import { includesProductionInputs } from "./production-claim-policy";
import { collectProductionClaimAwareRequiredTransportCategories, collectProductionClaimAwareTransportEntityIds } from "./production-claim-transport-scope";
import { frozenEntriesForAttempt, loadRemovalEntryContext } from "./removal-entry-context";
import { type RemovalScope } from "./removal-scope";
import {
  ISOMETRIC_PROVIDER,
  loadTransportLegsByCategory,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "./shared";
import { buildSubmissionAdvisories, buildSubmissionWarnings } from "./submission-warnings";
import type { RemovalSubmissionContext } from "./certify-context-types";
import { resolveRemovalTemplate } from "./resolve-removal-template";

export interface BuildRemovalContextOptions {
  /** The attempt whose own reservations are eligible during a rebuild. */
  claimedSubmissionId?: string;
  /** Include this Removal's claimed draft in submission eligibility. */
  submissionRead?: boolean;
  /** Suppress advisory recursion and storage summaries for DB-only comparison. */
  correctionRead?: boolean;
  /** Request-scoped facility carry discovery cache. */
  carryReads?: Map<string, ReturnType<typeof loadFacilityEmissionEntryCarry>>;
  /** Advisory projection supplied by the outer orchestration layer. */
  loadCorrection?: BatchEmissionContextOptions["loadCorrection"];
  /** Already-authorized contenders from the outer correction window. */
  coveredContenders?: CoveredContenders;
}

// Composes one Removal; defaults to no advisory corrections unless a loader is supplied.
export async function buildRemovalContext(
  orgCtx: OrgContext,
  scope: RemovalScope,
  facilityFacts: FacilityCertifierFacts,
  { claimedSubmissionId, submissionRead = false, correctionRead = false, carryReads, loadCorrection, coveredContenders }: BuildRemovalContextOptions = {},
): Promise<RemovalSubmissionContext> {
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
  const emissionContext = await loadBatchEmissionContext(orgCtx, scope.facilityId, scope.memberBatches, facilityFacts,
    { claimedAttempt: (claimedSubmissionId || submissionRead) && scope.removalId ? { removalId: scope.removalId, submissionId: claimedSubmissionId } : undefined, loadCorrection: correctionRead ? undefined : loadCorrection, carryReads, ownedRemovalId: scope.removalId ?? undefined, coveredContenders });
  const batchEmissionFacts = emissionContext.batchFacts;
  // Entry recovery may exclude its own draft from eligibility. Evidence retries
  // must still retain the operator files frozen when that draft was claimed.
  const correctionWindowOpen = latestSubmission?.status !== "draft" && Object.values(batchEmissionFacts).some(batch => batch.contenders?.some(
    contender => contender.removalId === scope.removalId && contender.contenderKind === "correction"));
  const frozenEntrySet = frozenEntriesForAttempt(latestSubmission, emissionContext);
  const loadedRemovalEntries = await loadRemovalEntryContext(orgCtx, scope, emissionContext, facilityFacts, frozenEntrySet);
  const removalEntryContext = loadedRemovalEntries && { contributions: loadedRemovalEntries.contributions,
    observationId: loadedRemovalEntries.observationId, semanticFingerprint: loadedRemovalEntries.semanticFingerprint };
  const templateFacts = resolveRemovalTemplate(scope.memberBatches, facilityFacts, loadedRemovalEntries?.batchFacts ?? batchEmissionFacts, removalEntryContext?.contributions);
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
  const claimCodes = await getRemovalCodes(orgCtx, scope.memberBatches.flatMap(b => b.productionEmissionsClaimedByRemovalId ? [b.productionEmissionsClaimedByRemovalId] : []));
  const memberBatchClaims = scope.memberBatches.map((b) => ({
    creditBatchId: b.id,
    code: b.code,
    durabilityOption: b.durabilityOption,
    claimedByRemovalId: b.productionEmissionsClaimedByRemovalId,
    claimingRemovalCode: claimCodes.get(b.productionEmissionsClaimedByRemovalId ?? "") ?? null,
    productionRunIds: [...b.productionRunIds].sort(),
    applicationIds: [...b.applicationIds].sort(),
    applicationSlices: b.applicationSlices,
  }));

  // The removal-owned facts above are loaded before the entry context.
  const deletionInProgress = hasFreshRemovalDeletionLease(scope.removal?.metadata);
  const registryBoundaryOpened = removalMayHaveExternalMutation(
    scope.removal?.metadata ?? null,
  );
  const supportingDocuments = correctionRead ? { total: 0, mirrored: 0 } : await loadEvidenceMirrorSummaryForScope(
    orgCtx,
    scope,
    latestSubmission,
    correctionWindowOpen,
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
  const templateTierBlocker = templateFacts.removalTemplate
    ? removalTemplateTierCompatibilityBlocker({ batchesWithSamples }, templateFacts.removalTemplate)
    : null;
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
      facilityTimezone: facilityFacts.facilityTimezone,
      removalId: scope.removalId,
      reportingWindowStartedOn: scope.removal?.startedOn ?? null,
      reportingWindowCompletedOn: scope.removal?.completedOn ?? null,
      hasOrgCredentials: facilityFacts.hasOrgCredentials,
      mapping: facilityFacts.mapping,
      project: facilityFacts.project,
      ...templateFacts,
      removalEntryContext,
      correctionWindowOpen,
      memberBatches: memberBatchesWithSubmissionGates,
      feedstockTypeMappingGaps,
      feedstockCodes: scope.feedstockCodes,
      transportCoverage: EMPTY_TRANSPORT_COVERAGE,
      hasSubmittableRuns: false,
      productionReadinessGap,
      entityReadinessGaps: [],
      submissionLineageBlockers: [],
      durabilityGateBlockers,
      durabilityConfigurationBlockers: durabilityConfigBlockers,
      templateTierBlocker,
      // No applications and no runs resolved ⇒ no date to be in the future.
      futureDatedMeasurements: [],
      submissionAdvisories: [],
      submissionWarnings: [
        ...durabilityWarnings,
        ...soilTemperatureGate.warnings,
      ],
      supportingDocuments,
      runSummary: EMPTY_RUN_SUMMARY,
      latestSubmission,
      hasFinalizedSubmission: hasFinalized,
      registryBoundaryOpened,
      deletionInProgress,
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
  const distanceFixLinks = await getTransportDistanceFixLinks(orgCtx,
    submissionLineageBlockers.filter(blocker => blocker.fixTarget === "feedstocks").map(blocker => blocker.record.id),
    submissionLineageBlockers.filter(blocker => blocker.fixTarget === "deliveryDistances").map(blocker => blocker.record.id),
  );
  for (const blocker of submissionLineageBlockers) {
    if (blocker.fixTarget === "feedstocks" || blocker.fixTarget === "deliveryDistances") {
      blocker.record.href = distanceFixLinks.get(blocker.record.id);
    }
  }
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

  const submissionAdvisories = buildSubmissionAdvisories({
    removalTemplate: templateFacts.removalTemplate, lineSources: templateFacts.lineSources,
    transportLegs: recordedTransportLegs, runs, lineages,
  });
  const submissionWarnings = [
    ...buildSubmissionWarnings({
      removalTemplate: templateFacts.removalTemplate,
      lineSources: templateFacts.lineSources,
      transportLegs: recordedTransportLegs,
      runs,
      lineages,
      facilityTimezone: facilityFacts.facilityTimezone,
    }),
    ...entityReadiness.warnings,
    ...durabilityWarnings,
    ...soilTemperatureGate.warnings,
  ];

  return {
    facilityId: scope.facilityId,
    facilityTimezone: facilityFacts.facilityTimezone,
    removalId: scope.removalId,
    reportingWindowStartedOn: scope.removal?.startedOn ?? null,
    reportingWindowCompletedOn: scope.removal?.completedOn ?? null,
    hasOrgCredentials: facilityFacts.hasOrgCredentials,
    mapping: facilityFacts.mapping,
    project: facilityFacts.project,
    ...templateFacts,
    removalEntryContext,
    correctionWindowOpen,
    entryCorrectionsByBatchId: Object.fromEntries(Object.entries(batchEmissionFacts).map(([id, batch]) => [id, batch.corrections ?? []])),
    requiredTransportCategories,
    memberBatches: memberBatchesWithSubmissionGates,
    feedstockTypeMappingGaps,
    feedstockCodes: scope.feedstockCodes,
    transportCoverage,
    hasSubmittableRuns: runs.length > 0 && !productionReadinessGap,
    productionReadinessGap,
    entityReadinessGaps: entityReadiness.gaps,
    submissionLineageBlockers,
    entityReadinessIssues: entityReadiness.issues,
    durabilityGateBlockers,
    durabilityConfigurationBlockers: durabilityConfigBlockers,
    templateTierBlocker,
    futureDatedMeasurements: collectFutureDatedMeasurements({
      facilityTimezone: facilityFacts.facilityTimezone,
      runs,
      samples: batchesWithSamples.flatMap((batch) => batch.samples),
      lineages,
    }),
    submissionWarnings,
    submissionAdvisories,
    supportingDocuments,
    runSummary,
    latestSubmission,
    hasFinalizedSubmission: hasFinalized,
    registryBoundaryOpened,
    deletionInProgress,
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
