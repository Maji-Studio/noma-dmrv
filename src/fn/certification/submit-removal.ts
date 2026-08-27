import type { OrgContext } from "@/lib/auth/server";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import {
  claimSubmissionDraft,
  type ClaimBlockedReason,
  type MappingClaimGuard,
} from "@/data-access/certification-submissions";
import { env } from "@/config/env";
import { markRemovalSubmissionExternalMutationPossible } from "@/data-access/certifier-removals";
import { reserveProductionEmissionsClaims } from "@/data-access/production-claim-reservations";
import { SafeError } from "@/lib/errors";
import { logger, type Logger } from "@/lib/log";
import {
  createDatapoint,
  createGhgEntry,
  getIsometricClientForOrg,
  payloadHash,
  reconcileDatapoint,
  reconcileRemoval,
  type IsometricComponentBlueprint,
  type IsometricGhgEntryTemplate,
  type IsometricClient,
} from "@/lib/isometric";
import { MAPPING_REVISION } from "@/lib/isometric/transformers/datapoint";
import { buildCreateGhgEntryRequest } from "@/lib/isometric/transformers/ghg-entry";
import {
  bindSequestrationDatapointsToTemplate,
} from "@/lib/isometric/transformers/sequestration-binding";
import {
  isSequestrationBlueprintKey,
} from "@/lib/isometric/transformers/measurement-sample";
import { loadRemovalSubmissionContext } from "./certify-context-core";
import {
  assertSupportedDurabilityConfiguration,
  DURABILITY_MEASUREMENT_SAMPLES_ENABLED,
  DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE,
  submitDurabilityMeasurementSamples,
  type DurabilityMeasurementSampleSubmission,
} from "./durability-measurement-samples";
import { bindProductionBatchesToMeasurementSamples } from "./production-batches";
import { readRemovalDurabilityMeasurementSamples } from "./durability-measurement-sample-snapshot";
import {
  assertProductionClaimGateFresh,
  assertResumedSnapshotRevisionCurrent,
} from "./production-claim-gate";
import { includesProductionInputs } from "./production-claim-policy";
import { ensureEvidenceLedgersFromContext } from "./ensure-evidence-ledgers";
import {
  readRemovalBiocharApplicationIntents,
  readRemovalFixedInputs,
  readRemovalSourceBindingPlan,
  readRemovalSupersedePreviousId,
  readRemovalTransport,
  type ResolvedFixedInput,
  type RemovalTransportSnapshot,
} from "./removal-snapshot-readers";
import { ensureRemovalBiocharApplications } from "./biochar-applications";
import type { BiocharApplicationIntent } from "./biochar-application-intents";
import { readRemovalReportingWindow } from "./removal-reporting-window";
import {
  finalizeRemovalSubmission,
  persistRemovalReportingWindow,
  recordRemovalConfirmedIdentity,
  recoverSubmittedRemovalReportingWindow,
} from "./removal-submission-finalization";
import {
  assertEntityReadinessGapsResolved,
  buildRemovalSubmissionBuild,
  compileRemovalSubmission,
  materializeRemovalSubmissionSnapshot,
  removalTemplateTierCompatibilityBlocker,
} from "./removal-submission-build";
import { assertClaimedRemovalPayloadFresh } from "./removal-submission-freshness";
import { checkProtocolVersionAtSubmit } from "./protocol-version-preflight";
import {
  performRegistryCreate,
  supplierRefLookup,
} from "./registry-create";
import {
  recordClaimedRemovalSubmissionFailureBestEffort,
  recordRemovalExternalMutation,
  readRemovalSubmissionExternalMutation,
  safeRemovalSubmissionError,
  type RemovalExternalMutation,
} from "./removal-submission-failure";
import {
  mirrorCandidateSourcesForSubmission,
  resolveSourceBindingCandidates,
} from "./sources";
import { verifyAndPersistRemovalSourceBindings } from "./removal-source-binding-verification";
import { reviewPayloadHash } from "@/lib/certification/removal-review-hash";
import { describeFeedstockTypeMappingGap } from "@/lib/certification/feedstock-type-mapping";
import type { SubmissionProgressReporter } from "@/lib/certification/submission-progress";
import {
  appendSyncEventBestEffort,
  assertProductionConfirmed,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "./shared";

// Domain wording for the claim module's blocked outcomes (the module owns
// only the mapping-guard wording; claim decisions are translated here).
const REMOVAL_CLAIM_BLOCKED_MESSAGES: Record<ClaimBlockedReason, string> = {
  "in-flight": "A submission for this Removal is already in progress.",
  "rejected-with-external":
    "This Removal was rejected by the verifier. Resolve the rejection in the Isometric registry before retrying.",
  // Removal policy is `supersede`; invalid-changed-hash is unreachable but
  // kept so future policy changes are explicit.
  "invalid-changed-hash":
    "This Removal changed while the submission was being prepared. Reload and try again.",
  "state-changed":
    "The submission changed while preparing the Removal. Reload and try again.",
};

export interface SubmitRemovalArgs {
  orgCtx: OrgContext;
  removalId: string;
  confirmProduction?: boolean;
  /** Hash of the artifact shown in the operator's compiled review. */
  expectedCompilationHash?: string;
  onProgress?: SubmissionProgressReporter;
}

export interface RemovalSubmissionResult {
  removalId: string;
  externalId: string;
  version: number;
}

interface RemovalSubmitAttempt {
  id: string;
  attemptedAt: Date;
  externalMutation: RemovalExternalMutation;
}

// The submission unit: one Isometric Removal == one certifierRemovals row.
// Loads the removal's full context (every member credit batch's deduped run
// union + applied-biochar attribution), aggregates ALL runs together with
// linear mass allocation, builds the datapoints/removal payload, claims a
// ledger row keyed on the removal, and POSTs. A completed removal
// short-circuits via `decideSubmissionClaim → return-existing`; a failed or
// locked one resumes. Throws on any aggregation/transport/template gap.
export async function submitRemoval(
  args: SubmitRemovalArgs,
): Promise<RemovalSubmissionResult> {
  const attempt: RemovalSubmitAttempt = {
    id: crypto.randomUUID(),
    attemptedAt: new Date(),
    externalMutation: "none",
  };
  let outcome: "succeeded" | "refused" | "failed" = "failed";
  let attemptError: unknown = null;

  try {
    const result = await submitRemovalCore(args, attempt);
    outcome = "succeeded";
    return result;
  } catch (error) {
    attemptError = error;
    outcome =
      attempt.externalMutation === "none" && error instanceof SafeError
        ? "refused"
        : "failed";
    throw error;
  } finally {
    const safeError = safeRemovalSubmissionError(attemptError);
    // Best-effort: a failed audit insert must not mask the submission's own
    // error or turn a successful return into a throw.
    await appendSyncEventBestEffort(args.orgCtx, {
      provider: ISOMETRIC_PROVIDER,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: args.removalId,
      operation: "removal:submit:attempt-summary",
      status: outcome === "succeeded" ? "succeeded" : "failed",
      responsePayload: {
        attempt_id: attempt.id,
        outcome,
        error_class: safeError.errorClass,
        error_message: safeError.errorMessage,
        ghg_entry_external_mutation: attempt.externalMutation,
      },
      errorMessage: safeError.errorMessage,
      attemptedAt: attempt.attemptedAt,
    });
  }
}

async function submitRemovalCore(
  args: SubmitRemovalArgs,
  attempt: RemovalSubmitAttempt,
): Promise<RemovalSubmissionResult> {
  const {
    orgCtx,
    removalId,
    confirmProduction,
    expectedCompilationHash,
    onProgress,
  } = args;

  // Per-attempt correlation id so the start breadcrumb, boundary logs, and any
  // best-effort warnings for one submit can be tied together in an aggregator.
  const log = logger.child({
    op: "removal:submit",
    removalId,
    submissionAttemptId: attempt.id,
  });
  log.info("removal submit started");
  onProgress?.({ step: "removal.checking_data", state: "active" });

  const ctx = await loadRemovalSubmissionContext(orgCtx, removalId);
  if (!ctx.mapping) {
    throw new SafeError("Link a facility to an Isometric project first.");
  }
  if (!ctx.hasOrgCredentials) {
    throw new SafeError(
      "Configure organization Isometric credentials before submitting.",
    );
  }
  if (
    ctx.latestSubmission?.status === "submitted" &&
    ctx.latestSubmission.externalId &&
    (!ctx.reportingWindowStartedOn || !ctx.reportingWindowCompletedOn)
  ) {
    assertProductionConfirmed(confirmProduction);
    attempt.externalMutation = "confirmed";
    const client = await getIsometricClientForOrg(orgCtx.organizationId);
    onProgress?.({ step: "removal.checking_data", state: "complete" });
    onProgress?.({ step: "removal.creating", state: "reused" });
    await recoverSubmittedRemovalReportingWindow({ client, orgCtx, removalId, row: ctx.latestSubmission, log });
    onProgress?.({ step: "removal.complete", state: "complete" });
    return { removalId, externalId: ctx.latestSubmission.externalId, version: ctx.latestSubmission.version };
  }
  if (ctx.feedstockTypeMappingGaps.length > 0) {
    throw new SafeError(
      ctx.feedstockTypeMappingGaps
        .map(describeFeedstockTypeMappingGap)
        .join(" "),
    );
  }
  // Fail before the submit-phase client, evidence-ledger generation/mirroring,
  // local ledger claims, or registry writes. Context loading may already make
  // read-only registry calls to resolve the configured project and template.
  // The build layer repeats this assertion as a defensive seam for callers that
  // prepare a submission outside this orchestrator.
  assertEntityReadinessGapsResolved(ctx.entityReadinessGaps);
  if (ctx.missingDefaultTemplateId) {
    throw new SafeError(
      "The facility's default Removal template was not found in Certify. Refresh the link in facility settings.",
    );
  }
  if (!ctx.defaultTemplate) {
    throw new SafeError("Set a default Removal template before submitting.");
  }
  // Pin the narrowed (non-null) template into a const — TS loses narrowing of
  // a property access (`ctx.defaultTemplate`) inside async callbacks below.
  const defaultTemplate = ctx.defaultTemplate;
  // The save path validates this too, but the template lives on Isometric and
  // can change credit_type after binding — a REDUCTION template must never mislabel a GHG entry.
  if (defaultTemplate.credit_type !== "REMOVAL") {
    throw new SafeError(
      "The facility's default template is not a REMOVAL template. Rebind a REMOVAL template in facility settings before submitting.",
    );
  }
  if (ctx.unresolvedBlueprintKeys.length > 0) {
    throw new SafeError(
      "The registry template is out of date. Refresh the facility link in settings before submitting.",
    );
  }
  if (defaultTemplate.groups.length === 0) {
    throw new SafeError(
      "The default Removal template has no fields to submit. Choose another template in facility settings.",
    );
  }

  // Phase 4 template↔tier guard (ADR 0021): the removal template's sequestration
  // blueprint must match the facility's durability tier — a 200-year facility
  // submits against a `biochar_sequestration_200_year_*` template, a 1000-year
  // facility against the current sampled 1,000-year component. Fail closed EARLY with an
  // actionable message on a mismatch (or an unknown sequestration variant),
  // rather than letting resolveTemplateInputs silently skip the component or the
  // generic staging gate below misdescribe a template↔tier misconfiguration as
  // "staged but not live". The tier is a single facility-scoped value (ADR 0021),
  // read here from the durability data plane.
  const facilityTier = ctx.batchesWithSamples[0]?.durabilityOption ?? null;
  const tierBlocker = removalTemplateTierCompatibilityBlocker(
    ctx,
    defaultTemplate,
  );
  if (tierBlocker) throw new SafeError(tierBlocker);

  // Durability evidence comes through measurement samples; each binding then
  // declares whether its GHG input consumes a sample-response datapoint or an
  // orchestrator-posted direct datapoint. Block while the sandbox-only flag is
  // off: without the evidence step the required sources cannot be bound, and
  // emitting an emissions-only GHG entry is forbidden.
  const hasDurabilityComponents = defaultTemplate.groups.some((group) =>
    group.components.some((c) => isSequestrationBlueprintKey(c.blueprint_key)),
  );
  if (hasDurabilityComponents && !DURABILITY_MEASUREMENT_SAMPLES_ENABLED) {
    throw new SafeError(DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE);
  }
  if (hasDurabilityComponents) {
    assertSupportedDurabilityConfiguration(ctx.batchesWithSamples);
  }

  assertProductionConfirmed(confirmProduction);

  if (ctx.memberBatches.length === 0) {
    throw new SafeError("This Removal has no credit batches.");
  }
  if (!facilityTier) {
    throw new SafeError(
      "Facility durability tier could not be resolved. Reload and retry.",
    );
  }

  const productionClaimBatchIds = ctx.memberBatchClaims
    .filter((batch) =>
      includesProductionInputs(batch.claimedByRemovalId, removalId),
    )
    .map((batch) => batch.creditBatchId);

  const blueprintsByKey = new Map(
    ctx.blueprintsForTemplate.map((bp) => [bp.key, bp]),
  );
  const externalProjectId = ctx.mapping.externalProjectId;
  const mappingGuard: MappingClaimGuard = {
    facilityId: ctx.facilityId,
    provider: ISOMETRIC_PROVIDER,
    expectedExternalProjectId: externalProjectId,
    expectedDefaultRemovalTemplateId: ctx.mapping.defaultRemovalTemplateId,
    expectedDurabilityOption: facilityTier,
  };

  // ADR 0005 escape hatch: in SANDBOX, a Removal Template that still declares a
  // period-input tuple (e.g. pyrolyzer_direct concentration) emits a
  // 0-magnitude stub instead of failing closed, so the pipeline can be
  // exercised before the real LCA value lands. Production NEVER stubs — 0 is an
  // over-claim for these positive emissions. See docs/open-questions.md.
  const allowPeriodInputStub = env.ISOMETRIC_ENVIRONMENT === "sandbox";

  // Run the complete aggregation, durability, transport, reporting-window,
  // and template-input validation before generating or mirroring evidence.
  // Supplying an explicit empty Source set keeps this preflight free of the
  // candidate-document walk; its build output is intentionally discarded.
  await buildRemovalSubmissionBuild({
    orgCtx,
    removalId,
    ctx,
    defaultTemplate,
    blueprintsByKey,
    externalProjectId,
    allowPeriodInputStub,
    hasDurabilityComponents,
    sourceIds: [],
  });
  onProgress?.({ step: "removal.checking_data", state: "complete" });
  onProgress?.({ step: "removal.preparing_evidence", state: "active" });

  // The advisory protocol check appends a local sync event on mismatch/missing.
  // Keep it after the complete side-effect-free build so invalid source data
  // leaves no audit mutation, but before client construction and every registry
  // or submission-ledger mutation.
  await checkProtocolVersionAtSubmit({
    orgCtx,
    removalId,
    mapping: ctx.mapping,
    log,
  });
  const client = await getIsometricClientForOrg(orgCtx.organizationId);

  // Everything below may create or update Isometric Sources before the
  // submission ledger draft exists. Persist that the registry boundary is
  // about to open while sharing discard's row/artifact lock protocol. The
  // marker stays set even when mirroring fails because the remote outcome may
  // be ambiguous and a missing local mapping cannot prove no Source exists.
  await markRemovalSubmissionExternalMutationPossible(
    orgCtx,
    ctx.facilityId,
    removalId,
  );

  // Materialize the deterministic transport and durability evidence PDFs
  // before candidate discovery. The generated documents attach to member
  // credit batches, then enter the same candidate, mirror-lock, snapshot, and
  // per-input attribution path as operator-provided evidence.
  await ensureEvidenceLedgersFromContext(orgCtx, removalId, ctx, log);

  const reviewedCompilation = await compileRemovalSubmission({
    orgCtx,
    removalId,
    ctx,
    defaultTemplate,
    blueprintsByKey,
    externalProjectId,
    allowPeriodInputStub,
    hasDurabilityComponents,
    log,
    allowPendingSources: true,
  });
  if (!reviewedCompilation.transportPlan) {
    throw new SafeError(
      `Removal submission blocked:\n${reviewedCompilation.blockers.join("\n")}`,
    );
  }
  const reviewedBuild = reviewedCompilation.transportPlan;
  assertReviewedCompilationHash(expectedCompilationHash, reviewedBuild);

  await mirrorCandidateSourcesForSubmission(orgCtx, {
    removalId,
    candidateDocumentIds: reviewedBuild.candidateDocumentIds,
  });

  // Compile again from persisted mappings. Only this strict artifact can be
  // claimed and sent; a failed/partial automatic mirror therefore leaves no
  // submission snapshot or registry GHG Entry behind.
  const initialCompilation = await compileRemovalSubmission({
    orgCtx,
    removalId,
    ctx,
    defaultTemplate,
    blueprintsByKey,
    externalProjectId,
    allowPeriodInputStub,
    hasDurabilityComponents,
    log,
  });
  if (!initialCompilation.transportPlan) {
    throw new SafeError(
      `Removal submission blocked:\n${initialCompilation.blockers.join("\n")}`,
    );
  }
  const initialBuild = initialCompilation.transportPlan;
  // Re-assert AFTER copying evidence. The reviewed fingerprint is Source-ID
  // independent, so this compares like with like: it passes when the only change
  // was IDs materializing, and fails when the evidence set itself moved — e.g.
  // another operator removed or reclassified a supporting file mid-submission.
  // Without this, that changed artifact could be claimed and sent unreviewed.
  assertReviewedCompilationHash(expectedCompilationHash, initialBuild);
  const {
    reportingWindow,
    candidateDocumentIds,
    candidateSourceDocuments,
    sourceIds,
    fixed,
  } = initialBuild;

  // Claim a ledger draft through the submission-ledger module. The module
  // holds the mapping lock plus the per-document mirror locks while it
  // re-resolves source IDs and re-decides the claim — the interlock with
  // unlinkDocumentSource and mirrorDocumentToSource (which acquire the same
  // per-(provider, documentId) advisory locks). Without it, a concurrent
  // unlink could delete a mapping between the unlocked source-id read above
  // and the snapshot insert, orphaning the audit-trail reference.
  const claimed = await claimSubmissionDraft(orgCtx, {
    key: {
      provider: ISOMETRIC_PROVIDER,
      submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: REMOVAL_ENTITY_TYPE,
      localEntityId: removalId,
    },
    guard: mappingGuard,
    policy: { onSubmittedHashChanged: "supersede" },
    tentativeInputs: initialBuild,
    hashOf: (inputs) => payloadHash(inputs.semanticPayload),
    mirrorDocumentIds: candidateDocumentIds,
    resolve: async (tx, tentative) => {
      // Re-resolve inside the lock. mirror and unlink are now serialized
      // against us, so this result is the authoritative source set. Common
      // case: it matches the tentative set and everything built above
      // remains valid; the rare path rebuilds the template inputs once.
      const lockedSourceBindingCandidates = await resolveSourceBindingCandidates(
        orgCtx,
        { candidates: candidateSourceDocuments },
        tx,
      );
      const lockedSourceIds = Array.from(
        new Set(
          lockedSourceBindingCandidates.map((candidate) => candidate.sourceId),
        ),
      ).sort();
      const sourceIdsChanged =
        lockedSourceIds.length !== sourceIds.length ||
        lockedSourceIds.some((id, i) => id !== sourceIds[i]);
      if (!sourceIdsChanged) return tentative;

      const finalCompilation = await compileRemovalSubmission({
        orgCtx,
        removalId,
        ctx,
        defaultTemplate,
        blueprintsByKey,
        externalProjectId,
        allowPeriodInputStub,
        hasDurabilityComponents,
        candidateDocumentIds,
        candidateSourceDocuments,
        sourceBindingCandidates: lockedSourceBindingCandidates,
      });
      if (!finalCompilation.transportPlan) {
        throw new SafeError(
          `Removal submission blocked:\n${finalCompilation.blockers.join("\n")}`,
        );
      }
      assertReviewedCompilationHash(
        expectedCompilationHash,
        finalCompilation.transportPlan,
      );
      return finalCompilation.transportPlan;
    },
    buildSnapshot: ({ inputs, nextVersion, supersedePreviousId }) =>
      materializeRemovalSubmissionSnapshot({
        compiled: inputs,
        template: defaultTemplate,
        externalProjectId,
        removalId,
        nextVersion,
        supersedePreviousId,
      }),
  });

  switch (claimed.kind) {
    case "blocked":
      throw new SafeError(REMOVAL_CLAIM_BLOCKED_MESSAGES[claimed.reason]);
    case "existing":
      if (
        !ctx.latestSubmission ||
        ctx.latestSubmission.externalId !== claimed.externalId ||
        ctx.latestSubmission.version !== claimed.version
      ) {
        throw new SafeError(
          "The existing Removal submission changed while verifying evidence. Reload and retry.",
        );
      }
      onProgress?.({ step: "removal.preparing_evidence", state: "complete" });
      onProgress?.({
        step: "removal.sending_inputs",
        state: initialBuild.datapointBodyByKey.size > 0 ? "reused" : "skipped",
      });
      onProgress?.({
        step: "removal.sending_durability",
        state: initialBuild.durabilityMeasurementSampleArgs
          ? "reused"
          : "skipped",
      });
      onProgress?.({ step: "removal.creating", state: "reused" });
      await ensureRemovalBiocharApplications({
        orgCtx,
        removalId,
        externalRemovalId: claimed.externalId,
        submissionRow: ctx.latestSubmission,
        intents: readRemovalBiocharApplicationIntents(ctx.latestSubmission),
        log,
      });
      onProgress?.({
        step: "removal.verifying_evidence",
        state: "active",
      });
      await verifyAndPersistRemovalSourceBindings({
        client,
        orgCtx,
        removalId,
        submissionRow: ctx.latestSubmission,
        externalRemovalId: claimed.externalId,
        log,
      });
      onProgress?.({
        step: "removal.verifying_evidence",
        state: "complete",
      });
      onProgress?.({ step: "removal.complete", state: "complete" });
      return {
        removalId,
        externalId: claimed.externalId,
        version: claimed.version,
      };
    case "claimed": {
      const expectedLockedAt = claimed.row.lockedAt;
      if (!expectedLockedAt) {
        throw new SafeError(
          "The Removal submission lock changed while preparing the registry request. Reload and retry.",
        );
      }
      if (claimed.resumed) {
        attempt.externalMutation = claimed.row.externalId
          ? "confirmed"
          : readRemovalSubmissionExternalMutation(claimed.row.metadata);
      }
      try {
        if (claimed.resumed) {
          await assertResumedSnapshotRevisionCurrent(
            orgCtx,
            claimed.row,
            attempt.externalMutation !== "none",
          );
        }
        await assertProductionClaimGateFresh(
          orgCtx,
          removalId,
          ctx.memberBatchClaims,
          claimed.row.id,
        );
        await assertClaimedRemovalPayloadFresh({
          orgCtx,
          removalId,
          row: claimed.row,
          allowPeriodInputStub,
          preserveForReconciliation: attempt.externalMutation !== "none",
        });
        await reserveProductionEmissionsClaims(orgCtx, {
          removalId,
          submissionId: claimed.row.id,
          creditBatchIds: productionClaimBatchIds,
        });
        if (claimed.reason === "rejected-hash-changed") {
          log.warn(
            { submissionId: claimed.row.id },
            "removal retry will create a new version after rejected row with changed hash",
          );
        }
        onProgress?.({ step: "removal.preparing_evidence", state: "complete" });
        const transport = readRemovalTransport(claimed.row);
        const sourceBindingPlan = readRemovalSourceBindingPlan(claimed.row);
        const effectiveFixed = claimed.resumed
          ? readRemovalFixedInputs(claimed.row)
          : fixed;
        const durabilityMeasurementSubmissions = hasDurabilityComponents
          ? readRemovalDurabilityMeasurementSamples(claimed.row)
          : null;
        const biocharApplicationIntents =
          readRemovalBiocharApplicationIntents(claimed.row);
        return await runRemovalSubmission({
          client,
          orgCtx,
          removalId,
          row: claimed.row,
          transport,
          fixed: effectiveFixed,
          template: defaultTemplate,
          blueprintsByKey,
          reportingWindow: {
            startedOn: reportingWindow.startedOn,
            completedOn: reportingWindow.completedOn,
          },
          externalProjectId,
          durabilityMeasurementSubmissions,
          biocharApplicationIntents,
          sourceBindingPlan,
          claimBatchIds: productionClaimBatchIds,
          supersedePreviousId: claimed.resumed
            ? readRemovalSupersedePreviousId(claimed.row)
            : claimed.supersedePreviousId,
          resumed: claimed.resumed,
          expectedLockedAt,
          attempt,
          log,
          onProgress,
        });
      } catch (error) {
        await recordClaimedRemovalSubmissionFailureBestEffort({
          orgCtx,
          submissionId: claimed.row.id,
          expectedLockedAt,
          externalMutation: attempt.externalMutation,
          error,
          log,
        });
        throw error;
      }
    }
  }
}

/**
 * Re-assert the fingerprint the operator reviewed. Uses `reviewPayloadHash`, not
 * the full payload hash, so that registry Source IDs materializing during this
 * submission do not invalidate the operator's own artifact — see
 * `removal-review-hash.ts`. A genuine evidence change (a file added, removed, or
 * rebound) still moves this hash through `candidateSources`.
 */
function assertReviewedCompilationHash(
  expectedHash: string | undefined,
  compiled: { semanticPayload: Record<string, unknown> },
): void {
  if (!expectedHash) return;
  if (reviewPayloadHash(compiled.semanticPayload) === expectedHash) return;
  throw new SafeError(
    "This Removal's data changed after you reviewed it. Reload the Removal and check the updated summary before submitting.",
  );
}

interface RunRemovalSubmissionArgs {
  client: IsometricClient;
  orgCtx: OrgContext;
  removalId: string;
  row: CertificationSubmissionRow;
  transport: RemovalTransportSnapshot;
  fixed: ResolvedFixedInput[];
  template: IsometricGhgEntryTemplate;
  blueprintsByKey: Map<string, IsometricComponentBlueprint>;
  // §8.6.2 window: production start → latest application date (issue #320).
  reportingWindow: Parameters<
    typeof buildCreateGhgEntryRequest
  >[0]["reportingWindow"];
  externalProjectId: string;
  // Versioned snapshot bodies for the durability measurement-samples step — null
  // unless the template declares a sequestration component (Phase 3).
  durabilityMeasurementSubmissions:
    | DurabilityMeasurementSampleSubmission[]
    | null;
  biocharApplicationIntents: BiocharApplicationIntent[];
  sourceBindingPlan: ReturnType<typeof readRemovalSourceBindingPlan>;
  // Member credit batches whose §8.6.2 production-bucket claim this submission
  // stamps on success (issue #349, ADR 0020).
  claimBatchIds: string[];
  supersedePreviousId: string | null;
  resumed: boolean;
  expectedLockedAt: Date;
  attempt: RemovalSubmitAttempt;
  /** Attempt-scoped logger (carries submissionAttemptId) from submitRemoval. */
  log: Logger;
  onProgress?: SubmissionProgressReporter;
}

async function runRemovalSubmission({
  client,
  orgCtx,
  removalId,
  row,
  transport,
  fixed,
  template,
  blueprintsByKey,
  reportingWindow,
  externalProjectId,
  durabilityMeasurementSubmissions,
  biocharApplicationIntents,
  sourceBindingPlan,
  claimBatchIds,
  supersedePreviousId,
  resumed,
  expectedLockedAt,
  attempt,
  log,
  onProgress,
}: RunRemovalSubmissionArgs): Promise<RemovalSubmissionResult> {
  // On resume the datapoint bodies and fixed bindings are snapshot truth, so
  // the removal body's reporting window must also come from the snapshot — not
  // the live window, whose lineage/run set may have shifted while the draft
  // was locked (a pre-#320 draft correctly resumes with its locked
  // production-end window). On create, the snapshot was just built from this
  // same window, so the override is a no-op.
  const effectiveWindow = resumed
    ? readRemovalReportingWindow(row)
    : reportingWindow;

  let datapointIdsByRtcInput = new Map<string, string[]>();
  for (const f of fixed) {
    datapointIdsByRtcInput.set(
      `${f.removalTemplateComponentId}::${f.inputKey}`,
      [f.preboundDatapointId],
    );
  }

  const datapointTotal = transport.datapointBodies.length;
  if (datapointTotal === 0) {
    onProgress?.({ step: "removal.sending_inputs", state: "skipped" });
  } else {
    onProgress?.({
      step: "removal.sending_inputs",
      state: "active",
      completed: 0,
      total: datapointTotal,
    });
  }
  let datapointCompleted = 0;
  for (const dp of transport.datapointBodies) {
    const supplierRefId = dp.body.supplier_reference_id;
    const { externalId } = await performRegistryCreate({
      orgCtx,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: removalId,
      submissionRowId: row.id,
      expectedLockedAt,
      deferRejectionToAttempt: true,
      operation: `datapoint:create:${dp.inputKey}`,
      requestPayload: dp.body,
      supplierRefId,
      resumed,
      create: () => createDatapoint(client, dp.body).then((d) => d.id),
      reconcile: () => reconcileDatapoint(client, { supplierRefId }).then(supplierRefLookup),
      failureMessagePrefix: `Datapoint POST failed for "${dp.inputKey}"`,
      onExternalMutation: (state) =>
        recordRemovalExternalMutation(attempt, state),
      log,
    });
    const rtcInputKey = `${dp.rtcId}::${dp.inputKey}`;
    datapointIdsByRtcInput.set(rtcInputKey, [
      ...(datapointIdsByRtcInput.get(rtcInputKey) ?? []),
      externalId,
    ]);
    datapointCompleted += 1;
    onProgress?.({
      step: "removal.sending_inputs",
      state:
        datapointCompleted === datapointTotal ? "complete" : "active",
      completed: datapointCompleted,
      total: datapointTotal,
    });
  }

  // Phase 3: POST the sampled 1000-year durability measurement sample after
  // the datapoint loop, before the removal body.
  // Measurement-property inputs (carbon lists and s_fraction) bind response
  // datapoints; the direct product_mass input was already posted through the
  // idempotent loop above. The gate is already open whenever submissions are
  // present; the explicit guard is defence-in-depth for future callers.
  if (durabilityMeasurementSubmissions && !DURABILITY_MEASUREMENT_SAMPLES_ENABLED) {
    throw new SafeError(DURABILITY_SUBMISSION_UNAVAILABLE_MESSAGE);
  }
  if (durabilityMeasurementSubmissions) {
    const durabilityTotal = durabilityMeasurementSubmissions.length;
    onProgress?.({
      step: "removal.sending_durability",
      state: durabilityTotal === 0 ? "skipped" : "active",
      completed: 0,
      total: durabilityTotal,
    });
    // Issue #630: the registry needs the Production Batch to exist before a
    // MeasurementSample can point at it, so register (or reuse) it first and
    // stamp the resulting `ptb_…` onto the snapshot bodies.
    const boundSubmissions = await bindProductionBatchesToMeasurementSamples({
      orgCtx,
      removalId,
      submissionRow: row,
      expectedLockedAt,
      deferRejectionToAttempt: true,
      onExternalMutation: (state) =>
        recordRemovalExternalMutation(attempt, state),
      submissions: durabilityMeasurementSubmissions,
      log,
    });
    const {
      submitted,
      datapointIdsByMeasurementProperty,
    } = await submitDurabilityMeasurementSamples({
      orgCtx,
      removalId,
      submissionRow: row,
      resumed,
      expectedLockedAt,
      deferRejectionToAttempt: true,
      onExternalMutation: (state) =>
        recordRemovalExternalMutation(attempt, state),
      submissions: boundSubmissions,
      sourceBindingPlan,
      log,
      onProgress: (completed, total) => {
        onProgress?.({
          step: "removal.sending_durability",
          state: "active",
          completed,
          total,
        });
      },
    });
    datapointIdsByRtcInput = bindSequestrationDatapointsToTemplate({
      template,
      datapointIdsByMeasurementProperty,
      datapointIdsByRtcInput,
    });
    log.info({ submitted }, "durability measurement samples submitted");
    if (durabilityTotal > 0) {
      onProgress?.({
        step: "removal.sending_durability",
        state: "complete",
        completed: durabilityTotal,
        total: durabilityTotal,
      });
    }
  } else {
    onProgress?.({ step: "removal.sending_durability", state: "skipped" });
  }

  onProgress?.({ step: "removal.creating", state: "active" });
  const removalBody = buildCreateGhgEntryRequest({
    template,
    blueprintsByKey,
    datapointIdsByRtcInput,
    reportingWindow: effectiveWindow,
    projectId: externalProjectId,
    supplierRefId: transport.removalSupplierRef,
    omittedTemplateComponentIds: transport.omittedTemplateComponentIds,
  });
  const externalRemovalId =
    row.externalId ??
    (
      await performRegistryCreate({
        orgCtx,
        entityType: REMOVAL_ENTITY_TYPE,
        entityId: removalId,
        submissionRowId: row.id,
        expectedLockedAt,
        deferRejectionToAttempt: true,
        operation: "removal:create",
        requestPayload: removalBody,
        supplierRefId: transport.removalSupplierRef,
        resumed,
        create: () => createGhgEntry(client, removalBody).then((r) => r.id),
        reconcile: () =>
          reconcileRemoval(client, {
            supplierRefId: transport.removalSupplierRef,
          }).then(supplierRefLookup),
        failureMessagePrefix: "Removal POST failed",
        onExternalMutation: (state) =>
          recordRemovalExternalMutation(attempt, state),
        onConfirmed: (externalId) =>
          recordRemovalConfirmedIdentity({
            orgCtx,
            rowId: row.id,
            externalId,
            expectedLockedAt,
          }),
        log,
      })
    ).externalId;
  await ensureRemovalBiocharApplications({
    orgCtx,
    removalId,
    externalRemovalId,
    submissionRow: row,
    expectedLockedAt,
    intents: biocharApplicationIntents,
    onExternalMutation: (state) =>
      recordRemovalExternalMutation(attempt, state),
    log,
  });
  onProgress?.({ step: "removal.creating", state: "complete" });

  // The reporting window drives GHG Statement membership. Keep the ledger
  // draft retryable until it is persisted; otherwise a remote GHG Entry can be
  // shown locally as Submitted while no reporting period can include it.
  await persistRemovalReportingWindow(orgCtx, removalId, effectiveWindow);

  if (resumed) {
    await appendSyncEventBestEffort(
      orgCtx,
      {
        provider: ISOMETRIC_PROVIDER,
        entityType: REMOVAL_ENTITY_TYPE,
        entityId: removalId,
        operation: "removal:create:resumed",
        status: "succeeded",
        responsePayload: {
          id: externalRemovalId,
          mapping_revision: MAPPING_REVISION,
        },
      },
      { submissionId: row.id },
    );
  }

  onProgress?.({ step: "removal.verifying_evidence", state: "active" });
  await verifyAndPersistRemovalSourceBindings({
    client,
    orgCtx,
    removalId,
    submissionRow: row,
    externalRemovalId,
    log,
  });
  // Finalize only after every dependent Biochar Application (and its Storage
  // Location) has reconciled and the local reporting window exists. Any
  // earlier failure keeps this row as an interrupted draft so the next submit
  // can safely reuse the already-created registry identities.
  await finalizeRemovalSubmission({
    orgCtx,
    row,
    externalId: externalRemovalId,
    expectedLockedAt,
    supersedePreviousId,
    removalId,
    claimBatchIds,
  });
  onProgress?.({
    step: "removal.verifying_evidence",
    state: "complete",
  });
  onProgress?.({ step: "removal.complete", state: "complete" });

  return { removalId, externalId: externalRemovalId, version: row.version };
}
