import type { OrgContext } from "@/lib/auth/server";
import {
  markSubmissionSubmitted,
  retireStaleSubmissionDraft,
  stampProductionEmissionsClaim,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
import {
  claimSubmissionDraft,
  type ClaimBlockedReason,
  type MappingClaimGuard,
} from "@/data-access/certification-submissions";
import { env } from "@/config/env";
import { updateRemovalDates } from "@/data-access/certifier-removals";
import { formatUtcDate } from "@/lib/date-utils";
import { SafeError } from "@/lib/errors";
import { logger, type Logger } from "@/lib/log";
import {
  buildRemovalSupplierRef,
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
  expectedSequestrationBlueprintKeys,
  isSequestrationBlueprintFamily,
  isSequestrationBlueprintKey,
} from "@/lib/isometric/transformers/measurement-sample";
import { loadRemovalSubmissionContext } from "./certify-context-core";
import {
  DURABILITY_MEASUREMENT_SAMPLES_LIVE,
  submitDurabilityMeasurementSamples,
  type DurabilityMeasurementSampleSubmission,
} from "./durability-measurement-samples";
import {
  buildVersionedMeasurementSampleSubmissions,
  readRemovalDurabilityMeasurementSamples,
} from "./durability-measurement-sample-snapshot";
import { ensureEvidenceLedgersFromContext } from "./ensure-evidence-ledgers";
import {
  assertNoForeignProductionClaims,
  assertProductionClaimGateFresh,
  assertResumedSnapshotRevisionCurrent,
} from "./production-claim-gate";
import {
  readRemovalFixedInputs,
  readRemovalTransport,
  type ResolvedFixedInput,
  type RemovalTransportSnapshot,
} from "./removal-snapshot-readers";
import { readRemovalReportingWindow } from "./removal-reporting-window";
import { buildRemovalSubmissionBuild } from "./removal-submission-build";
import { performRegistryCreate, supplierRefLookup } from "./registry-create";
import { resolveSourceIdsForRemoval } from "./sources";
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
  "in-flight": "A Removal submission for this removal is already in progress.",
  "rejected-with-external":
    "This Removal was rejected by the verifier. Resolve the rejection in the Isometric registry before retrying.",
  // Removal policy is `supersede`; invalid-changed-hash is unreachable but
  // kept so future policy changes are explicit.
  "invalid-changed-hash": "Unexpected submission state for this removal.",
  "state-changed":
    "Submission state changed while preparing the removal. Reload and retry.",
};

export interface SubmitRemovalArgs {
  orgCtx: OrgContext;
  removalId: string;
  confirmProduction?: boolean;
}

export interface RemovalSubmissionResult {
  removalId: string;
  externalId: string;
  version: number;
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
  const { orgCtx, removalId, confirmProduction } = args;

  // Per-attempt correlation id so the start breadcrumb, boundary logs, and any
  // best-effort warnings for one submit can be tied together in an aggregator.
  const submissionAttemptId = crypto.randomUUID();
  const log = logger.child({
    op: "removal:submit",
    removalId,
    submissionAttemptId,
  });
  log.info("removal submit started");

  const ctx = await loadRemovalSubmissionContext(orgCtx, removalId);
  if (!ctx.mapping) {
    throw new SafeError("Link a facility to an Isometric project first.");
  }
  if (!ctx.hasOrgCredentials) {
    throw new SafeError(
      "Configure organization Isometric credentials before submitting.",
    );
  }
  const client = await getIsometricClientForOrg(orgCtx.organizationId);
  if (ctx.missingDefaultTemplateId) {
    throw new SafeError(
      "The facility's default removal template was not found in Certify. Refresh the link in facility settings.",
    );
  }
  if (!ctx.defaultTemplate) {
    throw new SafeError("Set a default removal template before submitting.");
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
      `Cannot submit: blueprints out of sync with Certify (${ctx.unresolvedBlueprintKeys.join(", ")}). Refresh in facility settings.`,
    );
  }
  if (defaultTemplate.groups.length === 0) {
    throw new SafeError(
      "Default removal template has no components - nothing to submit.",
    );
  }

  // Phase 4 template↔tier guard (ADR 0021): the removal template's sequestration
  // blueprint must match the facility's durability tier — a 200-year facility
  // submits against a `biochar_sequestration_200_year_*` template, a 1000-year
  // facility against `biochar_sequestration_1000_year`. Fail closed EARLY with an
  // actionable message on a mismatch (or an unknown sequestration variant),
  // rather than letting resolveTemplateInputs silently skip the component or the
  // generic staging gate below misdescribe a template↔tier misconfiguration as
  // "staged but not live". The tier is a single facility-scoped value (ADR 0021),
  // read here from the durability data plane.
  const facilityTier = ctx.batchesWithSamples[0]?.durabilityOption ?? null;
  const templateSequestrationKeys = defaultTemplate.groups.flatMap((group) =>
    group.components
      .map((component) => component.blueprint_key)
      .filter(isSequestrationBlueprintFamily),
  );
  if (facilityTier && templateSequestrationKeys.length > 0) {
    const expectedKeys = expectedSequestrationBlueprintKeys(facilityTier);
    const mismatched = templateSequestrationKeys.find(
      (key) => !expectedKeys.has(key),
    );
    if (mismatched) {
      const tierLabel = facilityTier === "1000_year" ? "1000-year" : "200-year";
      throw new SafeError(
        `This facility is on the ${tierLabel} durability tier, but its removal ` +
          `template's sequestration component is "${mismatched}". Re-author the ` +
          `facility's Isometric removal template to the ` +
          `${Array.from(expectedKeys).join(" or ")} blueprint, or change the ` +
          `facility's durability tier in facility settings.`,
      );
    }
  }

  // Phase 3 gate: a template carrying a `biochar_sequestration_200_year_*`
  // component routes its durability inputs through the measurement-samples step,
  // whose live POST is staged behind two sandbox-empirical confirms (binding +
  // unit scalings). Block such a submission while the flag is off rather than
  // POST an under-specified removal (the sequestration components are skipped in
  // resolveTemplateInputs / the removal body), so the new template can't be
  // submitted until the confirms land. See docs/open-questions.md
  // `isometric/durability-measurement-samples`.
  const hasDurabilityComponents = defaultTemplate.groups.some((group) =>
    group.components.some((c) => isSequestrationBlueprintKey(c.blueprint_key)),
  );
  if (hasDurabilityComponents && !DURABILITY_MEASUREMENT_SAMPLES_LIVE) {
    throw new SafeError(
      "Durability submission is staged but not yet live — pending the sandbox " +
        "confirms (datapoint↔input binding, measurement unit scalings, and — for " +
        "1000-year — the s_fraction derivation). Enable " +
        "DURABILITY_MEASUREMENT_SAMPLES_LIVE after confirming them.",
    );
  }

  assertProductionConfirmed(confirmProduction);

  if (ctx.memberBatches.length === 0) {
    throw new SafeError("This removal has no credit batches.");
  }

  // §8.6.2 front-loading pre-flight (issue #349, ADR 0020): fail closed on a
  // foreign production-bucket claim BEFORE aggregation, the evidence ledgers,
  // and every registry POST. Re-asserted from a fresh read after the draft
  // claim below — see production-claim-gate.ts for the TOCTOU rationale.
  assertNoForeignProductionClaims(ctx.memberBatchClaims, removalId);

  const blueprintsByKey = new Map(
    ctx.blueprintsForTemplate.map((bp) => [bp.key, bp]),
  );
  const externalProjectId = ctx.mapping.externalProjectId;
  const mappingGuard: MappingClaimGuard = {
    facilityId: ctx.facilityId,
    provider: ISOMETRIC_PROVIDER,
    expectedExternalProjectId: externalProjectId,
    expectedDefaultRemovalTemplateId: ctx.mapping.defaultRemovalTemplateId,
  };

  // Regenerate every Source-mirrored evidence ledger (transport mass·distance +
  // 200-year durability) from the live context and mirror them BEFORE candidate
  // documents are collected, so the current ledgers ride into source_ids on this
  // submit (and supersede any prior ones). Done here — before the locked claim
  // transaction below — because it makes HTTP calls to Isometric and inserts
  // documents under a per-removal artifact lock. Best-effort and idempotent on
  // content (an unchanged resubmit is a no-op); each ledger self-skips when it
  // has nothing to evidence.
  await ensureEvidenceLedgersFromContext(orgCtx, removalId, ctx, log);

  // ADR 0005 escape hatch: in SANDBOX, a Removal Template that still declares a
  // period-input tuple (e.g. pyrolyzer_direct concentration) emits a
  // 0-magnitude stub instead of failing closed, so the pipeline can be
  // exercised before the real LCA value lands. Production NEVER stubs — 0 is an
  // over-claim for these positive emissions. See docs/open-questions.md.
  const allowPeriodInputStub = env.ISOMETRIC_ENVIRONMENT === "sandbox";

  const initialBuild = await buildRemovalSubmissionBuild({
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
  const {
    agg,
    latestApplicationTime,
    candidateDocumentIds,
    sourceIds,
    semanticPayload,
    monitored,
    fixed,
    datapointBodyByKey,
    durabilityMeasurementSampleArgs,
    memberCreditBatchIds,
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
    tentativeInputs: {
      semanticPayload,
      monitored,
      datapointBodyByKey,
      durabilityMeasurementSampleArgs,
    },
    hashOf: (inputs) => payloadHash(inputs.semanticPayload),
    mirrorDocumentIds: candidateDocumentIds,
    resolve: async (tx, tentative) => {
      // Re-resolve inside the lock. mirror and unlink are now serialized
      // against us, so this result is the authoritative source set. Common
      // case: it matches the tentative set and everything built above
      // remains valid; the rare path rebuilds the template inputs once.
      const lockedSourceIds = await resolveSourceIdsForRemoval(
        orgCtx,
        { candidateDocumentIds },
        tx,
      );
      const sourceIdsChanged =
        lockedSourceIds.length !== sourceIds.length ||
        lockedSourceIds.some((id, i) => id !== sourceIds[i]);
      if (!sourceIdsChanged) return tentative;

      const finalBuild = await buildRemovalSubmissionBuild({
        orgCtx,
        removalId,
        ctx,
        defaultTemplate,
        blueprintsByKey,
        externalProjectId,
        allowPeriodInputStub,
        hasDurabilityComponents,
        sourceIds: lockedSourceIds,
      });
      return {
        semanticPayload: finalBuild.semanticPayload,
        monitored: finalBuild.monitored,
        datapointBodyByKey: finalBuild.datapointBodyByKey,
        durabilityMeasurementSampleArgs: finalBuild.durabilityMeasurementSampleArgs,
      };
    },
    buildSnapshot: ({ inputs, nextVersion }) => {
      const removalSupplierRef = buildRemovalSupplierRef({
        removalId,
        role: "removal",
        version: nextVersion,
      });

      const finalDatapointBodies = inputs.monitored.map((m) => {
        const supplierRefId = buildRemovalSupplierRef({
          removalId,
          role: "datapoint",
          version: nextVersion,
          inputKey: `${m.removalTemplateComponentId}-${m.inputKey}`,
        });
        const draftKey = `${m.removalTemplateComponentId}::${m.inputKey}`;
        const draft = inputs.datapointBodyByKey.get(draftKey);
        if (!draft) {
          // monitored and datapointBodyByKey are produced by the same
          // resolveTemplateInputs pass, so a miss means the two fell out of
          // sync — fail loudly rather than emit a Datapoint body missing
          // its resolved fields.
          throw new SafeError(
            `Internal: no resolved Datapoint body for ${draftKey}. Reload and retry the submission.`,
          );
        }
        return {
          rtcId: m.removalTemplateComponentId,
          inputKey: m.inputKey,
          body: { ...draft, supplier_reference_id: supplierRefId },
        };
      });
      const durabilityMeasurementSamples = inputs.durabilityMeasurementSampleArgs
        ? {
            submissions: buildVersionedMeasurementSampleSubmissions({
              ...inputs.durabilityMeasurementSampleArgs,
              version: nextVersion,
            }),
          }
        : undefined;

      return {
        payloadSnapshot: {
          // ADR 0005 / B3 — content hash of INPUT_MAPPING that produced
          // this payload, surfaced at the top level so an audit query
          // (`WHERE payload_snapshot->>'__mappingRevision' = ?`) can
          // correlate a registry-side issue back to a specific noma
          // mapping revision in git.
          __mappingRevision: MAPPING_REVISION,
          semantic: inputs.semanticPayload,
          memberCreditBatchIds,
          transport: {
            removalSupplierRef,
            datapointBodies: finalDatapointBodies,
          },
          ...(durabilityMeasurementSamples
            ? { durabilityMeasurementSamples }
            : {}),
        },
      };
    },
  });

  switch (claimed.kind) {
    case "blocked":
      throw new SafeError(REMOVAL_CLAIM_BLOCKED_MESSAGES[claimed.reason]);
    case "existing":
      // §8.6.2 lazy claim backfill (ADR 0020): a removal submitted before
      // migration 0068 whose payload hash is unchanged short-circuits here
      // and never reaches markSubmissionSubmitted's transactional stamp.
      // Stamp locally (no POST) — the blocking `submitted` row freezes
      // membership, so the live member set equals the submitted payload's.
      // The pre-flight gate above already asserted no foreign claims; a
      // raced foreign claim trips the stamp's rowcount backstop loudly.
      await stampProductionEmissionsClaim(orgCtx, {
        removalId,
        creditBatchIds: memberCreditBatchIds,
      });
      return {
        removalId,
        externalId: claimed.externalId,
        version: claimed.version,
      };
    case "claimed": {
      // ADR 0020 resume gate: never complete a draft whose snapshot was
      // built under an older INPUT_MAPPING revision — retire it and fail
      // closed instead (see production-claim-gate.ts).
      if (claimed.resumed) {
        await assertResumedSnapshotRevisionCurrent(orgCtx, claimed.row);
      }
      // §8.6.2 fresh-read re-assert (issue #349, ADR 0020): the blocking
      // draft row now exists, so membership is frozen — a foreign claim OR a
      // membership/run-lineage regroup that landed between context load and
      // this point is caught HERE, before any registry POST, instead of
      // shipping a stale payload and tripping the claim-stamp backstop after
      // the POSTs. See production-claim-gate.ts.
      await assertProductionClaimGateFresh(
        orgCtx,
        removalId,
        ctx.memberBatchClaims,
      );
      await assertClaimedRemovalPayloadFresh({
        orgCtx,
        removalId,
        row: claimed.row,
        allowPeriodInputStub,
      });
      if (claimed.reason === "rejected-hash-changed") {
        log.warn(
          { submissionId: claimed.row.id },
          "removal retry will create a new version after rejected row with changed hash",
        );
      }
      // The transport snapshot comes off the claimed row: on resume it is
      // the prior attempt's stored truth; on create it carries the
      // locked-source-id version of the datapoint bodies (which may differ
      // from the tentative `datapointBodyByKey` if a concurrent
      // mirror/unlink shifted the source set during lock acquisition).
      const transport = readRemovalTransport(claimed.row);
      // On resume, the fixed bindings must come from the SAME snapshot as the
      // transport — not the live `fixed` recomputed above, which may have
      // drifted from the version the snapshot was built against.
      const effectiveFixed = claimed.resumed
        ? readRemovalFixedInputs(claimed.row)
        : fixed;
      // Durability measurement-sample POST bodies are snapshot truth. On create
      // they carry the claimed versioned supplier refs; on resume they prevent a
      // stale draft from rebuilding bodies from changed live context.
      const durabilityMeasurementSubmissions = hasDurabilityComponents
        ? readRemovalDurabilityMeasurementSamples(claimed.row)
        : null;
      return runRemovalSubmission({
        client,
        orgCtx,
        removalId,
        row: claimed.row,
        transport,
        fixed: effectiveFixed,
        template: defaultTemplate,
        blueprintsByKey,
        reportingWindow: {
          startedOn: agg.earliestStartTime,
          completedOn: latestApplicationTime,
        },
        externalProjectId,
        durabilityMeasurementSubmissions,
        // The live member set — membership can't drift under a locked draft
        // (assertRemovalAllowsCreditBatchMutation), so these are the batches
        // whose production bucket this submission claims.
        claimBatchIds: memberCreditBatchIds,
        supersedePreviousId: claimed.supersedePreviousId,
        resumed: claimed.resumed,
        log,
      });
    }
  }
}

async function assertClaimedRemovalPayloadFresh(args: {
  orgCtx: OrgContext;
  removalId: string;
  row: CertificationSubmissionRow;
  allowPeriodInputStub: boolean;
}): Promise<void> {
  const { orgCtx, removalId, row, allowPeriodInputStub } = args;

  const freshCtx = await loadRemovalSubmissionContext(orgCtx, removalId);
  if (
    !freshCtx.mapping ||
    freshCtx.missingDefaultTemplateId ||
    !freshCtx.defaultTemplate ||
    freshCtx.defaultTemplate.credit_type !== "REMOVAL" ||
    freshCtx.unresolvedBlueprintKeys.length > 0 ||
    freshCtx.defaultTemplate.groups.length === 0
  ) {
    await retireStaleSubmissionDraft(orgCtx, row.id, {
      reason: "semantic payload rebuild failed after draft claim",
    });
    throw new SafeError(
      "Removal source data or template configuration changed while preparing this submission. The draft was retired; reload and submit again.",
    );
  }
  const freshHasDurabilityComponents = freshCtx.defaultTemplate.groups.some((group) =>
    group.components.some((c) => isSequestrationBlueprintKey(c.blueprint_key)),
  );
  if (freshHasDurabilityComponents && !DURABILITY_MEASUREMENT_SAMPLES_LIVE) {
    await retireStaleSubmissionDraft(orgCtx, row.id, {
      reason: "durability measurement-sample gate changed after draft claim",
    });
    throw new SafeError(
      "Removal template configuration changed while preparing this submission. The draft was retired; reload and submit again.",
    );
  }

  let freshBuild: Awaited<ReturnType<typeof buildRemovalSubmissionBuild>>;
  try {
    freshBuild = await buildRemovalSubmissionBuild({
      orgCtx,
      removalId,
      ctx: freshCtx,
      defaultTemplate: freshCtx.defaultTemplate,
      blueprintsByKey: new Map(
        freshCtx.blueprintsForTemplate.map((bp) => [bp.key, bp]),
      ),
      externalProjectId: freshCtx.mapping.externalProjectId,
      allowPeriodInputStub,
      hasDurabilityComponents: freshHasDurabilityComponents,
    });
  } catch (err) {
    await retireStaleSubmissionDraft(orgCtx, row.id, {
      reason: "semantic payload rebuild failed after draft claim",
    });
    throw err;
  }
  const freshHash = payloadHash(freshBuild.semanticPayload);
  if (freshHash === row.payloadHash) return;

  await retireStaleSubmissionDraft(orgCtx, row.id, {
    reason: `semantic payload drift: snapshot ${String(row.payloadHash)} != current ${freshHash}`,
  });
  throw new SafeError(
    "Removal source data changed while preparing this submission. The stale draft was retired; reload and submit again.",
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
  // Member credit batches whose §8.6.2 production-bucket claim this submission
  // stamps on success (issue #349, ADR 0020).
  claimBatchIds: string[];
  supersedePreviousId: string | null;
  resumed: boolean;
  /** Attempt-scoped logger (carries submissionAttemptId) from submitRemoval. */
  log: Logger;
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
  claimBatchIds,
  supersedePreviousId,
  resumed,
  log,
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

  const datapointIdsByRtcInput = new Map<string, string>();
  for (const f of fixed) {
    datapointIdsByRtcInput.set(
      `${f.removalTemplateComponentId}::${f.inputKey}`,
      f.preboundDatapointId,
    );
  }

  for (const dp of transport.datapointBodies) {
    const supplierRefId = dp.body.supplier_reference_id;
    const { externalId } = await performRegistryCreate({
      orgCtx,
      entityType: REMOVAL_ENTITY_TYPE,
      entityId: removalId,
      submissionRowId: row.id,
      operation: `datapoint:create:${dp.inputKey}`,
      requestPayload: dp.body,
      supplierRefId,
      resumed,
      create: () => createDatapoint(client, dp.body).then((d) => d.id),
      reconcile: () => reconcileDatapoint(client, { supplierRefId }).then(supplierRefLookup),
      failureMessagePrefix: `Datapoint POST failed for "${dp.inputKey}"`,
      log,
    });
    datapointIdsByRtcInput.set(`${dp.rtcId}::${dp.inputKey}`, externalId);
  }

  // Phase 3: POST the durability measurement samples (per-batch chemistry +
  // facility soil reference) after the datapoint loop, before the removal body —
  // each value yields a datapoint the registry binds to the sequestration
  // component. The flag is already on whenever submissions are present (the
  // submitRemoval gate blocks otherwise); the explicit guard is defence-in-depth
  // so a future caller can't accidentally fire the staged path.
  if (durabilityMeasurementSubmissions && DURABILITY_MEASUREMENT_SAMPLES_LIVE) {
    const { submitted } = await submitDurabilityMeasurementSamples({
      orgCtx,
      removalId,
      submissionRowId: row.id,
      resumed,
      submissions: durabilityMeasurementSubmissions,
      log,
    });
    log.info({ submitted }, "durability measurement samples submitted");
  }

  const removalBody = buildCreateGhgEntryRequest({
    template,
    blueprintsByKey,
    datapointIdsByRtcInput,
    reportingWindow: effectiveWindow,
    projectId: externalProjectId,
    supplierRefId: transport.removalSupplierRef,
  });
  const { externalId: externalRemovalId } = await performRegistryCreate({
    orgCtx,
    entityType: REMOVAL_ENTITY_TYPE,
    entityId: removalId,
    submissionRowId: row.id,
    operation: "removal:create",
    requestPayload: removalBody,
    supplierRefId: transport.removalSupplierRef,
    resumed,
    create: () => createGhgEntry(client, removalBody).then((r) => r.id),
    reconcile: () =>
      reconcileRemoval(client, { supplierRefId: transport.removalSupplierRef }).then(
        supplierRefLookup,
      ),
    failureMessagePrefix: "Removal POST failed",
    log,
  });

  await markSubmissionSubmitted(orgCtx, row.id, {
    externalId: externalRemovalId,
    supersedePreviousId,
    // §8.6.2 (issue #349, ADR 0020): stamp the production-bucket claim onto
    // the member batches in the same transaction as the ledger flip.
    productionEmissionsClaim: { removalId, creditBatchIds: claimBatchIds },
  });

  // Persist the derived reporting window onto the removal row (best-effort —
  // a failure here doesn't unwind a successful submission).
  try {
    await updateRemovalDates(orgCtx, removalId, {
      startedOn: formatUtcDate(effectiveWindow.startedOn),
      completedOn: formatUtcDate(effectiveWindow.completedOn),
    });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "failed to persist removal reporting window",
    );
  }

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

  return { removalId, externalId: externalRemovalId, version: row.version };
}
