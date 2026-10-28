import {
  getCertifierRemovalById,
} from "@/data-access/certifier-removals";
import {
  loadCreditBatchRollups,
  type CreditBatchRollupsByBatch,
} from "@/data-access/credit-batch-accounting";
import type { loadFacilityEmissionEntryCarry } from "@/data-access/emission-entry-carry";
import { requireOrgFacility } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadFacilityCertifierFacts, type FacilityCertifierFacts } from "./facility-certifier-facts";
import type { BuildRemovalContextOptions } from "./removal-context-build";
import { buildRemovalContext as buildContext } from "./removal-context-build";
import { loadRemovalEntryCorrection } from "./removal-correction-core";
import { buildRemovalLedgerPreview } from "./removal-ledger-preview";
import { resolveScopeForCreditBatch, resolveScopeForRemoval, resolveSingleBatchScope, type RemovalScope } from "./removal-scope";
import {
  buildSelectableBatchesData,
  type SelectableBatchesData,
} from "./selectable-batches";
export type { RemovalCertifyContext, RemovalSubmissionContext } from "./certify-context-types";
export type {
  TransportCategory,
  TransportCoverage,
  TransportCoverageBucket
} from "./certify-transport-coverage";
export { loadFacilityCertifierFacts, type FacilityCertifierFacts } from "./facility-certifier-facts";
export type { LinkedGhgStatementStatus } from "./linked-ghg-statement-status";
export type { MemberCreditBatch } from "./member-credit-batch";
export { resolveScopeForRemoval } from "./removal-scope";
export type { SelectableBatch, SelectableBatchesData } from "./selectable-batches";

// Bound facility fan-out so per-removal DB/registry query chains cannot burst
// the connection pool. Mirrors `READINESS_CONCURRENCY` in overview.ts.
const FANOUT_CONCURRENCY = 8;

import type { RemovalCertifyContext,RemovalSubmissionContext } from "./certify-context-types";

// Submission-pipeline context keyed by removal id — used by `submitRemoval`.
// Resolves the scope, then the facility facts for that scope's facility, then
// composes; the Overview queue reuses `buildRemovalContext` with facility facts
// loaded once across all of a facility's removals.
export async function loadRemovalSubmissionContext(
  orgCtx: OrgContext,
  removalId: string,
  options: { refreshEnrichment?: boolean; claimedSubmissionId?: string } = {},
): Promise<RemovalSubmissionContext> {
  const scope = await resolveScopeForRemoval(orgCtx, removalId);
  const facilityFacts = await loadFacilityCertifierFacts(
    orgCtx,
    scope.facilityId,
    options,
  );
  return buildRemovalContext(orgCtx, scope, facilityFacts, { claimedSubmissionId: options.claimedSubmissionId, submissionRead: true });
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
    undecidedLineIds: ctx.undecidedLineIds,
    entryCorrectionsByBatchId: ctx.entryCorrectionsByBatchId,
    emissionLines: ctx.emissionLines,
    emissionLinesByBatchId: ctx.emissionLinesByBatchId,
    carriedEntries: ctx.removalEntryContext?.contributions.carriedEntries ?? [],
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
    templateTierBlocker: ctx.templateTierBlocker,
    futureDatedMeasurements: ctx.futureDatedMeasurements,
    submissionWarnings: ctx.submissionWarnings,
    submissionAdvisories: ctx.submissionAdvisories,
    supportingDocuments: ctx.supportingDocuments,
    runSummary: ctx.runSummary,
    latestSubmission: ctx.latestSubmission,
    hasFinalizedSubmission: ctx.hasFinalizedSubmission,
    registryBoundaryOpened: ctx.registryBoundaryOpened,
    deletionInProgress: ctx.deletionInProgress,
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
): Promise<RemovalCertifyContext> {
  const scope = await resolveScopeForCreditBatch(orgCtx, creditBatchId);
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
  options?: { unassignedOnly?: boolean; carryReads?: Map<string, ReturnType<typeof loadFacilityEmissionEntryCarry>> },
): Promise<CreditBatchContextSet> {
  const accountingByBatch = options?.unassignedOnly
    ? await loadCreditBatchRollups(orgCtx, creditBatchIds, {
        unassignedOnly: true,
      })
    : await loadCreditBatchRollups(orgCtx, creditBatchIds);
  const carryReads = options?.carryReads ?? new Map<string, ReturnType<typeof loadFacilityEmissionEntryCarry>>();
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
            { carryReads },
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

/** Compose display reads with advisory corrections; the comparison uses the independent builder. */
export function buildRemovalContext(orgCtx: OrgContext, scope: RemovalScope, facilityFacts: FacilityCertifierFacts, options: BuildRemovalContextOptions = {}) {
  return buildContext(orgCtx, scope, facilityFacts, { ...options, loadCorrection: loadRemovalEntryCorrection });
}
