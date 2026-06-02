import {
  getLatestSubmission,
  insertDraftSubmissionWithMappingLockAndLocks,
  markSubmissionRejected,
  markSubmissionSubmitted,
  resetSubmissionToDraftWithMappingLock,
  type CertificationSubmissionRow,
  type CertifierProjectRow,
  type MappingClaimGuard,
} from "@/data-access/certification";
import { acquireMirrorLocksSorted } from "@/lib/isometric/utils/source-lock";
import { updateRemovalDates } from "@/data-access/certifier-removals";
import { formatUtcDate } from "@/lib/date-utils";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { SafeError } from "@/lib/errors";
import { logger } from "@/lib/log";
import { z } from "zod";
import {
  STAGE_SPLIT_SUM_TOLERANCE,
  STAGE_SPLIT_TOTAL_PCT,
} from "@/schemas/certification";
import {
  aggregateProductionRuns,
  buildRemovalSupplierRef,
  createDatapoint,
  createRemoval,
  decideSubmissionClaim,
  enrichWithFacilityConfig,
  enrichWithTransportLegs,
  payloadHash,
  reconcileDatapoint,
  reconcileRemoval,
  type CreateDatapointRequest,
  type FacilityEmissionConfig,
  type IsometricComponentBlueprint,
  type IsometricRemovalTemplate,
} from "@/lib/isometric";
import {
  buildCreateDatapointRequest,
  MAPPING_REVISION,
} from "@/lib/isometric/transformers/datapoint";
import { buildCreateRemovalRequest } from "@/lib/isometric/transformers/removal";
import { loadRemovalSubmissionContext } from "./certify-context";
import {
  collectCandidateDocumentIdsForRemoval,
  resolveSourceIdsForRemoval,
} from "./sources";
import {
  appendSyncEventBestEffort,
  assertProductionConfirmed,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "./shared";

// Reads the four Phase 3.7 emission-estimate columns off the facility's
// certifier_projects row. Throws if any is unset — they must be configured
// in the admin area (Emission estimates) before a submission can carry real
// per-stage energy data. Facility-level config, shared across the removal.
export function resolveFacilityEmissionConfig(
  mapping: CertifierProjectRow,
): FacilityEmissionConfig {
  const {
    gensetEnergyYieldKwhPerLitre,
    stageSplitBiomassPct,
    stageSplitPyrolysisPct,
    stageSplitBiocharPct,
  } = mapping;
  if (
    gensetEnergyYieldKwhPerLitre == null ||
    stageSplitBiomassPct == null ||
    stageSplitPyrolysisPct == null ||
    stageSplitBiocharPct == null
  ) {
    throw new SafeError(
      "Set this facility's genset yield and stage splits in the admin area (Emission estimates) before submitting.",
    );
  }

  // Defence-in-depth: the admin form validates these through
  // facilityEmissionConfigSchema, but a direct DB edit or seed insert could
  // bypass it. A bad value here would silently corrupt a registry
  // submission, so re-check the bounds before building the payload.
  if (
    !Number.isFinite(gensetEnergyYieldKwhPerLitre) ||
    gensetEnergyYieldKwhPerLitre <= 0
  ) {
    throw new SafeError(
      "This facility's genset energy yield must be a positive number. Correct it in the admin area (Emission estimates).",
    );
  }
  const stageSplits = [
    stageSplitBiomassPct,
    stageSplitPyrolysisPct,
    stageSplitBiocharPct,
  ];
  if (
    stageSplits.some(
      (pct) => !Number.isFinite(pct) || pct < 0 || pct > STAGE_SPLIT_TOTAL_PCT,
    )
  ) {
    throw new SafeError(
      "This facility's stage splits must each be between 0 and 100. Correct them in the admin area (Emission estimates).",
    );
  }
  const splitSum =
    stageSplitBiomassPct + stageSplitPyrolysisPct + stageSplitBiocharPct;
  if (Math.abs(splitSum - STAGE_SPLIT_TOTAL_PCT) > STAGE_SPLIT_SUM_TOLERANCE) {
    throw new SafeError(
      "This facility's stage splits must sum to 100%. Correct them in the admin area (Emission estimates).",
    );
  }

  return {
    gensetEnergyYieldKwhPerLitre,
    stageSplitBiomassPct,
    stageSplitPyrolysisPct,
    stageSplitBiocharPct,
  };
}

interface ResolvedMonitoredInput {
  removalTemplateComponentId: string;
  componentBlueprintKey: string;
  inputKey: string;
  quantity: { magnitude: number; unit: string };
  datapointType: string;
}

interface ResolvedFixedInput {
  removalTemplateComponentId: string;
  inputKey: string;
  preboundDatapointId: string;
}

interface DatapointTransport {
  rtcId: string;
  inputKey: string;
  body: CreateDatapointRequest;
}

interface RemovalTransportSnapshot {
  removalSupplierRef: string;
  datapointBodies: DatapointTransport[];
}

// Runtime guard for the JSONB payload_snapshot.transport read-back. The
// snapshot was written by an earlier deploy and may not match this deploy's
// in-memory shape — fail loud rather than post malformed datapoints when the
// schema has drifted (e.g. a body field renamed or removed).
const datapointTransportSchema = z.object({
  rtcId: z.string().min(1),
  inputKey: z.string().min(1),
  body: z
    .object({
      supplier_reference_id: z.string().min(1),
      // Phase 3.5: source_ids must be present in every snapshot. A
      // pre-Phase-3.5 draft (without this field) is "stale" — fail loud
      // locally rather than ship a malformed Datapoint to Isometric.
      source_ids: z.array(z.string()),
    })
    .passthrough(),
});
const removalTransportSnapshotSchema = z.object({
  removalSupplierRef: z.string().min(1),
  datapointBodies: z.array(datapointTransportSchema),
});

export interface SubmitRemovalArgs {
  userId: string;
  removalId: string;
  confirmProduction?: boolean;
}

export interface RemovalSubmissionResult {
  removalId: string;
  externalId: string;
  version: number;
}

interface ResolvedTemplateInputs {
  monitored: ResolvedMonitoredInput[];
  fixed: ResolvedFixedInput[];
  datapointBodyByKey: Map<string, CreateDatapointRequest>;
}

// Walks the removal template's components, classifying every input as a
// monitored datapoint (built from the aggregation) or a pre-bound fixed
// datapoint. Throws on any template/blueprint/mapping gap, on an unbound
// fixed input, or on a null aggregated source; blocks zero-stub inputs in
// production. Pure over its inputs — no I/O.
function resolveTemplateInputs(args: {
  template: IsometricRemovalTemplate;
  blueprintsByKey: Map<string, IsometricComponentBlueprint>;
  agg: ReturnType<typeof enrichWithFacilityConfig>;
  externalProjectId: string;
  // Removal-wide Isometric Source IDs (Phase 3.5). Threaded into every
  // monitored Datapoint's `source_ids` so the audit trail attaches evidence
  // to each datapoint posted to Isometric.
  sourceIds: string[];
}): ResolvedTemplateInputs {
  const { template, blueprintsByKey, agg, externalProjectId, sourceIds } = args;

  const monitored: ResolvedMonitoredInput[] = [];
  const fixed: ResolvedFixedInput[] = [];
  const datapointBodyByKey = new Map<string, CreateDatapointRequest>();
  const unboundFixedInputs: { component: string; inputKey: string }[] = [];

  for (const group of template.groups) {
    for (const component of group.components) {
      const blueprint = blueprintsByKey.get(component.blueprint_key);
      if (!blueprint) {
        throw new SafeError(
          `Blueprint "${component.blueprint_key}" missing from catalog.`,
        );
      }
      for (const rtcInput of component.inputs) {
        if (rtcInput.type === "fixed") {
          if (!rtcInput.datapoint_id) {
            unboundFixedInputs.push({
              component: component.display_name,
              inputKey: rtcInput.input_key,
            });
            continue;
          }
          fixed.push({
            removalTemplateComponentId: component.id,
            inputKey: rtcInput.input_key,
            preboundDatapointId: rtcInput.datapoint_id,
          });
          continue;
        }

        const blueprintInput = blueprint.inputs.find(
          (i) => i.input_key === rtcInput.input_key,
        );
        if (!blueprintInput) {
          throw new SafeError(
            `Blueprint "${blueprint.key}" missing input "${rtcInput.input_key}".`,
          );
        }
        // Don't pre-check the mapping here — buildCreateDatapointRequest
        // already runs the missing-mapping check AND the period-input
        // scope-conflict variant (ADR 0005 §3). A pre-check here would
        // throw the generic missing-mapping error first and swallow the
        // actionable scope-conflict guidance.
        const draft = buildCreateDatapointRequest({
          groupKey: group.key,
          componentBlueprintKey: component.blueprint_key,
          rtcInput,
          blueprintInput,
          agg,
          projectId: externalProjectId,
          supplierRefId: "__placeholder__",
          sourceIds,
        });
        monitored.push({
          removalTemplateComponentId: component.id,
          componentBlueprintKey: component.blueprint_key,
          inputKey: rtcInput.input_key,
          quantity: {
            magnitude: draft.quantity.magnitude,
            unit: draft.quantity.unit ?? "",
          },
          datapointType: draft.type,
        });
        datapointBodyByKey.set(`${component.id}::${rtcInput.input_key}`, draft);
      }
    }
  }

  if (unboundFixedInputs.length > 0) {
    const lines = unboundFixedInputs
      .map((u) => `  • ${u.component} → ${u.inputKey}`)
      .join("\n");
    throw new SafeError(
      `Template "${template.display_name}" has ${unboundFixedInputs.length} fixed input(s) without a pre-bound datapoint:\n${lines}\nBind each as a constant in the Isometric template editor before submitting.`,
    );
  }

  // ADR 0005 deletes the legacy zero-stub plumbing — period-input families
  // moved to PROJECT scope and the scope-conflict SafeError in
  // buildCreateDatapointRequest catches templates that still declare them
  // here. No production-promotion gate at this layer; pre-deploy gate #4
  // in integration-plan.md now lives in the nightly coverage check.

  return { monitored, fixed, datapointBodyByKey };
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
  const { userId, removalId, confirmProduction } = args;

  // Per-attempt correlation id so the start breadcrumb, boundary logs, and any
  // best-effort warnings for one submit can be tied together in an aggregator.
  const submissionAttemptId = crypto.randomUUID();
  const log = logger.child({
    op: "removal:submit",
    removalId,
    submissionAttemptId,
  });
  log.info("removal submit started");

  const ctx = await loadRemovalSubmissionContext(userId, removalId);
  if (!ctx.mapping) {
    throw new SafeError("Link a facility to an Isometric project first.");
  }
  if (ctx.missingDefaultTemplateId) {
    throw new SafeError(
      "The facility's default removal template was not found in Certify. Refresh the link in facility settings.",
    );
  }
  if (!ctx.defaultTemplate) {
    throw new SafeError("Set a default removal template before submitting.");
  }
  // Pin the narrowed (non-null) template into a const so closures created
  // below see the narrowed type without re-checking — TS loses narrowing of
  // a property access (`ctx.defaultTemplate`) when it crosses into an
  // async callback.
  const defaultTemplate = ctx.defaultTemplate;
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

  assertProductionConfirmed(confirmProduction);

  if (ctx.memberBatches.length === 0) {
    throw new SafeError("This removal has no credit batches.");
  }

  const lineageWarnings: string[] = [];
  for (const lineage of ctx.lineages) {
    lineageWarnings.push(
      ...lineage.warnings.map(
        (warning) => `Application ${lineage.application.code}: ${warning}`,
      ),
    );
    if (!lineage.productionRun) {
      throw new SafeError(
        `Application ${lineage.application.code} has no linked production run - cannot aggregate.`,
      );
    }
  }
  if (lineageWarnings.length > 0) {
    throw new SafeError(
      `Lineage incomplete for submission:\n${lineageWarnings.join("\n")}`,
    );
  }
  if (ctx.runs.length === 0) {
    throw new SafeError(
      "Production runs not found for the removal's credit batches.",
    );
  }

  const emissionConfig = resolveFacilityEmissionConfig(ctx.mapping);
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

  // Aggregate every member batch's runs into ONE Removal, applied-scoped:
  // `attributionByRunId` weights each run by the share of its biochar that
  // actually reached an application in this removal (linear mass allocation).
  const baseAgg = aggregateProductionRuns(ctx.runs, ctx.attributionByRunId);
  if (baseAgg.warnings.length > 0) {
    throw new SafeError(
      `Removal submission blocked:\n${baseAgg.warnings.join("\n")}`,
    );
  }

  const transportAgg = enrichWithTransportLegs(baseAgg, ctx.transportLegs);
  // Pooling legs across member batches raises the chance of a mixed
  // method/factor — Isometric Transportation v1.1 §5 requires per-leg
  // accounting, so block submission on those warnings.
  const transportWarnings = transportAgg.warnings.slice(
    baseAgg.warnings.length,
  );
  if (transportWarnings.length > 0) {
    throw new SafeError(
      `Removal transport-leg aggregation — submission blocked:\n${transportWarnings.join("\n")}`,
    );
  }

  const agg = enrichWithFacilityConfig(transportAgg, emissionConfig);

  // Phase 3.5: mirrored Isometric Source IDs ride into every monitored
  // Datapoint (removal-wide attribution). They are part of the semantic
  // hash so a sources change supersedes the previous Removal version. The
  // resolution is read-only and idempotent; submitRemoval is the canonical
  // place to snapshot the source set because that's when the payload is
  // locked.
  //
  // The candidate-document set is derived deterministically from the chain
  // ctx so it can be re-walked inside the locked transaction below. The
  // first resolution here is the "tentative" set used for the claim
  // decision; the locked re-resolution inside the snapshot insert is the
  // authoritative set, and if it differs we recompute the hash before
  // writing.
  const candidateDocumentIds = await collectCandidateDocumentIdsForRemoval(
    userId,
    {
      lineages: ctx.lineages,
      runs: ctx.runs,
      memberBatchIds: ctx.memberBatches.map((b) => b.id),
    },
  );
  const sourceIds = await resolveSourceIdsForRemoval(userId, {
    candidateDocumentIds,
  });

  const { monitored, fixed, datapointBodyByKey } = resolveTemplateInputs({
    template: defaultTemplate,
    blueprintsByKey,
    agg,
    externalProjectId,
    sourceIds,
  });

  // The hash is a function of what gets sent to Isometric — the run set and
  // the resolved inputs. Member credit-batch ids are recorded in the snapshot
  // for audit but kept OUT of the hash: a pure-membership change must not
  // POST a duplicate Isometric Removal (the supplier ref carries the version).
  const semanticPayload = {
    removalId,
    templateId: defaultTemplate.id,
    sourceProductionRunIds: [...agg.sourceProductionRunIds].sort(),
    startedOn: agg.earliestStartTime.toISOString(),
    completedOn: agg.latestEndTime.toISOString(),
    // Phase 3.5: sorted, deduped Isometric Source IDs. Hash-covered so
    // mirroring or unmirroring a source forces a new version (supersede).
    sourceIds,
    inputs: [
      ...monitored.map((m) => ({
        rtcId: m.removalTemplateComponentId,
        inputKey: m.inputKey,
        kind: "monitored" as const,
        value: m.quantity.magnitude,
        unit: m.quantity.unit,
        datapointType: m.datapointType,
      })),
      ...fixed.map((f) => ({
        rtcId: f.removalTemplateComponentId,
        inputKey: f.inputKey,
        kind: "fixed" as const,
        preboundDatapointId: f.preboundDatapointId,
      })),
    ].sort((a, b) =>
      `${a.rtcId}::${a.inputKey}`.localeCompare(`${b.rtcId}::${b.inputKey}`),
    ),
  };
  const semanticHash = payloadHash(semanticPayload);
  const memberCreditBatchIds = ctx.memberBatches
    .map((b) => b.id)
    .sort((a, b) => a.localeCompare(b));

  const latest = await getLatestSubmission(userId, {
    provider: ISOMETRIC_PROVIDER,
    submissionType: REMOVAL_SUBMISSION_TYPE,
    localEntityType: REMOVAL_ENTITY_TYPE,
    localEntityId: removalId,
  });

  const claim = decideSubmissionClaim({
    latest,
    payloadHash: semanticHash,
    now: Date.now(),
    lockTtlMs: LOCK_TTL_MS,
    policy: { onSubmittedHashChanged: "supersede" },
  });

  switch (claim.kind) {
    case "blocked-in-flight":
      throw new SafeError(
        "A Removal submission for this removal is already in progress.",
      );
    case "blocked-rejected-with-external":
      throw new SafeError(
        "This Removal was rejected by the verifier. Resolve the rejection in the Isometric registry before retrying.",
      );
    case "invalid-changed-hash":
      // Removal policy is `supersede`; this branch is unreachable but kept
      // for exhaustiveness so future policy changes are explicit.
      throw new SafeError("Unexpected submission state for this removal.");
    case "return-existing":
      return {
        removalId,
        externalId: claim.externalId,
        version: claim.version,
      };
    case "resume": {
      const row = await resetSubmissionToDraftWithMappingLock(
        userId,
        claim.resumeRowId,
        mappingGuard,
        LOCK_TTL_MS,
      );
      const transport = readRemovalTransport(row);
      return runRemovalSubmission({
        userId,
        removalId,
        row,
        transport,
        fixed,
        template: defaultTemplate,
        blueprintsByKey,
        agg,
        externalProjectId,
        supersedePreviousId: null,
        resumed: true,
      });
    }
    case "create-new-version": {
      if (claim.reason === "rejected-hash-changed") {
        log.warn(
          { submissionId: latest!.id },
          "removal retry will create a new version after rejected row with changed hash",
        );
      }
      const removalSupplierRef = buildRemovalSupplierRef({
        removalId,
        role: "removal",
        version: claim.nextVersion,
      });

      // Build the draft snapshot inside a transaction that holds per-
      // document mirror locks. Inside the lock we re-resolve source IDs,
      // and if they shifted vs. the tentative set the hash gets recomputed
      // before insert. This is the interlock with unlinkDocumentSource and
      // mirrorDocumentToSource — those acquire the same per-(provider,
      // documentId) advisory locks, so they block while submit is
      // resolving + inserting, and submit blocks while they're mutating.
      // Without this, a concurrent unlink could delete the mapping between
      // the unlocked source-id read above and the snapshot insert,
      // orphaning the audit-trail reference.
      const draftRow = await insertDraftSubmissionWithMappingLockAndLocks(
        userId,
        mappingGuard,
        async (tx) => {
          await acquireMirrorLocksSorted(tx, candidateDocumentIds);

          // Re-resolve inside the lock. mirror and unlink are now serialized
          // against us, so this result is the authoritative source set.
          const lockedSourceIds = await resolveSourceIdsForRemoval(
            userId,
            { candidateDocumentIds },
            tx,
          );

          // Common case: the locked re-read matches the tentative set;
          // semanticPayload / hash / datapointBodies built above remain
          // valid. The rare path rebuilds the template inputs once with
          // the locked source set.
          const sourceIdsChanged =
            lockedSourceIds.length !== sourceIds.length ||
            lockedSourceIds.some((id, i) => id !== sourceIds[i]);

          const finalSemanticPayload = sourceIdsChanged
            ? { ...semanticPayload, sourceIds: lockedSourceIds }
            : semanticPayload;
          const finalHash = sourceIdsChanged
            ? payloadHash(finalSemanticPayload)
            : semanticHash;
          const finalResolved = sourceIdsChanged
            ? resolveTemplateInputs({
                template: defaultTemplate,
                blueprintsByKey,
                agg,
                externalProjectId,
                sourceIds: lockedSourceIds,
              })
            : null;
          const finalMonitored = finalResolved?.monitored ?? monitored;
          const finalDatapointBodyByKey =
            finalResolved?.datapointBodyByKey ?? datapointBodyByKey;

          const finalDatapointBodies = finalMonitored.map((m) => {
            const supplierRefId = buildRemovalSupplierRef({
              removalId,
              role: "datapoint",
              version: claim.nextVersion,
              inputKey: `${m.removalTemplateComponentId}-${m.inputKey}`,
            });
            const draftKey = `${m.removalTemplateComponentId}::${m.inputKey}`;
            const draft = finalDatapointBodyByKey.get(draftKey);
            if (!draft) {
              // finalMonitored and finalDatapointBodyByKey are produced by the
              // same resolveTemplateInputs pass, so a miss means the two fell
              // out of sync — fail loudly rather than emit a Datapoint body
              // missing its resolved fields.
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

          return {
            provider: ISOMETRIC_PROVIDER,
            submissionType: REMOVAL_SUBMISSION_TYPE,
            localEntityType: REMOVAL_ENTITY_TYPE,
            localEntityId: removalId,
            version: claim.nextVersion,
            payloadSnapshot: {
              // ADR 0005 / B3 — content hash of INPUT_MAPPING that
              // produced this payload, surfaced at the top level so an
              // audit query (`WHERE payload_snapshot->>'__mappingRevision'
              // = ?`) can correlate a registry-side issue back to a
              // specific noma mapping revision in git.
              __mappingRevision: MAPPING_REVISION,
              semantic: finalSemanticPayload,
              memberCreditBatchIds,
              transport: {
                removalSupplierRef,
                datapointBodies: finalDatapointBodies,
              },
            },
            payloadHash: finalHash,
          };
        },
      );

      // Pull the transport snapshot back from the row we just inserted —
      // it carries the locked-source-id version of the datapoint bodies
      // (which may differ from the tentative `datapointBodyByKey` if a
      // concurrent mirror/unlink shifted the source set during the lock
      // acquisition).
      const transport = readRemovalTransport(draftRow);
      return runRemovalSubmission({
        userId,
        removalId,
        row: draftRow,
        transport,
        fixed,
        template: defaultTemplate,
        blueprintsByKey,
        agg,
        externalProjectId,
        supersedePreviousId: claim.supersedePreviousId,
        resumed: false,
      });
    }
    case "resume-poll-existing":
    case "resume-re-put":
      // Phase 5 Slice A claim kinds; only reachable when callers pass
      // `dataUploadResume`. Removal submission does not — kept here for
      // exhaustiveness so TS narrows the union end-to-end.
      throw new SafeError("Unexpected resume kind for removal submission.");
  }
}

interface RunRemovalSubmissionArgs {
  userId: string;
  removalId: string;
  row: CertificationSubmissionRow;
  transport: RemovalTransportSnapshot;
  fixed: ResolvedFixedInput[];
  template: IsometricRemovalTemplate;
  blueprintsByKey: Map<string, IsometricComponentBlueprint>;
  agg: Parameters<typeof buildCreateRemovalRequest>[0]["agg"];
  externalProjectId: string;
  supersedePreviousId: string | null;
  resumed: boolean;
}

async function runRemovalSubmission({
  userId,
  removalId,
  row,
  transport,
  fixed,
  template,
  blueprintsByKey,
  agg,
  externalProjectId,
  supersedePreviousId,
  resumed,
}: RunRemovalSubmissionArgs): Promise<RemovalSubmissionResult> {
  const datapointIdsByRtcInput = new Map<string, string>();
  for (const f of fixed) {
    datapointIdsByRtcInput.set(
      `${f.removalTemplateComponentId}::${f.inputKey}`,
      f.preboundDatapointId,
    );
  }

  for (const dp of transport.datapointBodies) {
    const supplierRefId = dp.body.supplier_reference_id;
    const externalId = await createOrReconcile({
      userId,
      removalId,
      row,
      operation: `datapoint:create:${dp.inputKey}`,
      requestPayload: dp.body,
      supplierRefId,
      resumed,
      create: () => createDatapoint(dp.body).then((d) => d.id),
      reconcile: () => reconcileDatapoint({ supplierRefId }),
      failureMessagePrefix: `Datapoint POST failed for "${dp.inputKey}"`,
    });
    datapointIdsByRtcInput.set(`${dp.rtcId}::${dp.inputKey}`, externalId);
  }

  const removalBody = buildCreateRemovalRequest({
    template,
    blueprintsByKey,
    datapointIdsByRtcInput,
    agg,
    projectId: externalProjectId,
    supplierRefId: transport.removalSupplierRef,
  });
  const externalRemovalId = await createOrReconcile({
    userId,
    removalId,
    row,
    operation: "removal:create",
    requestPayload: removalBody,
    supplierRefId: transport.removalSupplierRef,
    resumed,
    create: () => createRemoval(removalBody).then((r) => r.id),
    reconcile: () =>
      reconcileRemoval({ supplierRefId: transport.removalSupplierRef }),
    failureMessagePrefix: "Removal POST failed",
  });

  await markSubmissionSubmitted(userId, row.id, {
    externalId: externalRemovalId,
    supersedePreviousId,
  });

  // Persist the derived reporting window onto the removal row (best-effort —
  // a failure here doesn't unwind a successful submission).
  try {
    await updateRemovalDates(userId, removalId, {
      startedOn: formatUtcDate(agg.earliestStartTime),
      completedOn: formatUtcDate(agg.latestEndTime),
    });
  } catch (err) {
    logger.warn(
      {
        op: "removal:submit",
        removalId,
        err: err instanceof Error ? err.message : String(err),
      },
      "failed to persist removal reporting window",
    );
  }

  if (resumed) {
    await appendSyncEventBestEffort(
      userId,
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

interface CreateOrReconcileArgs {
  userId: string;
  removalId: string;
  row: CertificationSubmissionRow;
  operation: string;
  requestPayload: unknown;
  supplierRefId: string;
  resumed: boolean;
  create: () => Promise<string>;
  reconcile: () => Promise<
    { found: true; externalId: string } | { found: false }
  >;
  failureMessagePrefix: string;
}

async function createOrReconcile(args: CreateOrReconcileArgs): Promise<string> {
  const baseEvent = {
    provider: ISOMETRIC_PROVIDER,
    entityType: REMOVAL_ENTITY_TYPE,
    entityId: args.removalId,
  } as const;

  const recordReconciled = async (externalId: string) => {
    await appendSyncEventBestEffort(
      args.userId,
      {
        ...baseEvent,
        operation: `${args.operation}:reconciled`,
        status: "succeeded",
        requestPayload: args.requestPayload,
        responsePayload: {
          id: externalId,
          source: "reconciliation",
          mapping_revision: MAPPING_REVISION,
        },
      },
      { submissionId: args.row.id },
    );
  };

  if (args.resumed) {
    const reconciled = await args.reconcile();
    if (reconciled.found) {
      await recordReconciled(reconciled.externalId);
      return reconciled.externalId;
    }
  }

  try {
    const externalId = await args.create();
    await appendSyncEventBestEffort(
      args.userId,
      {
        ...baseEvent,
        operation: args.operation,
        status: "succeeded",
        requestPayload: args.requestPayload,
        responsePayload: {
          id: externalId,
          supplier_reference_id: args.supplierRefId,
          mapping_revision: MAPPING_REVISION,
        },
      },
      { submissionId: args.row.id },
    );
    return externalId;
  } catch (err) {
    const reconciled = await args.reconcile();
    if (reconciled.found) {
      await recordReconciled(reconciled.externalId);
      return reconciled.externalId;
    }

    const message = err instanceof Error ? err.message : String(err);
    // ADR 0005 / B3 — failure events historically carried only
    // `errorMessage`; embed `mapping_revision` in `responsePayload` so the
    // audit trail still names which mapping revision produced the failed
    // payload.
    await appendSyncEventBestEffort(
      args.userId,
      {
        ...baseEvent,
        operation: args.operation,
        status: "failed",
        requestPayload: args.requestPayload,
        responsePayload: { mapping_revision: MAPPING_REVISION },
        errorMessage: message,
      },
      { submissionId: args.row.id },
    );
    await markSubmissionRejected(args.userId, args.row.id, {
      errorMessage: message,
    });
    throw new SafeError(`${args.failureMessagePrefix}: ${message}`);
  }
}

function readRemovalTransport(
  row: CertificationSubmissionRow,
): RemovalTransportSnapshot {
  const snapshot = row.payloadSnapshot as { transport?: unknown } | null;
  const parsed = removalTransportSnapshotSchema.safeParse(snapshot?.transport);
  if (!parsed.success) {
    throw new SafeError(
      "Stale submission cannot be resumed because its transport snapshot does not match the current payload schema.",
    );
  }
  return {
    removalSupplierRef: parsed.data.removalSupplierRef,
    datapointBodies: parsed.data.datapointBodies as DatapointTransport[],
  };
}
