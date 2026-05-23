import {
  appendSyncEvent,
  type AppendSyncEventInput,
  getLatestSubmission,
  insertDraftSubmissionWithMappingLock,
  markSubmissionRejected,
  markSubmissionSubmitted,
  resetSubmissionToDraftWithMappingLock,
  type CertificationSubmissionRow,
  type CertifierProjectRow,
  type MappingClaimGuard,
} from "@/data-access/certification";
import { updateRemovalDates } from "@/data-access/certifier-removals";
import { formatUtcDate } from "@/lib/date-utils";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { SafeError } from "@/lib/errors";
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
  lookupInputMapping,
} from "@/lib/isometric/transformers/datapoint";
import { buildCreateRemovalRequest } from "@/lib/isometric/transformers/removal";
import { loadRemovalSubmissionContext } from "./certify-context";
import {
  assertNoZeroStubsInProduction,
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
}): ResolvedTemplateInputs {
  const { template, blueprintsByKey, agg, externalProjectId } = args;

  const monitored: ResolvedMonitoredInput[] = [];
  const fixed: ResolvedFixedInput[] = [];
  const datapointBodyByKey = new Map<string, CreateDatapointRequest>();
  const unboundFixedInputs: { component: string; inputKey: string }[] = [];
  const zeroStubInputs: { component: string; inputKey: string }[] = [];

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
        const mapping = lookupInputMapping(
          group.key,
          component.blueprint_key,
          rtcInput.input_key,
        );
        if (!mapping) {
          throw new SafeError(
            `No INPUT_MAPPING entry for group="${group.key}" blueprint="${component.blueprint_key}" input="${rtcInput.input_key}".`,
          );
        }
        if (mapping.zeroStub) {
          zeroStubInputs.push({
            component: component.display_name,
            inputKey: rtcInput.input_key,
          });
        }
        const raw = agg[mapping.source];
        if (raw == null) {
          throw new SafeError(
            `Aggregated source ${String(mapping.source)} for input "${rtcInput.input_key}" (group="${group.key}") is null.`,
          );
        }
        const draft = buildCreateDatapointRequest({
          groupKey: group.key,
          componentBlueprintKey: component.blueprint_key,
          rtcInput,
          blueprintInput,
          agg,
          projectId: externalProjectId,
          supplierRefId: "__placeholder__",
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

  assertNoZeroStubsInProduction(zeroStubInputs);

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
  if (ctx.unresolvedBlueprintKeys.length > 0) {
    throw new SafeError(
      `Cannot submit: blueprints out of sync with Certify (${ctx.unresolvedBlueprintKeys.join(", ")}). Refresh in facility settings.`,
    );
  }
  if (ctx.defaultTemplate.groups.length === 0) {
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

  const { monitored, fixed, datapointBodyByKey } = resolveTemplateInputs({
    template: ctx.defaultTemplate,
    blueprintsByKey,
    agg,
    externalProjectId,
  });

  // The hash is a function of what gets sent to Isometric — the run set and
  // the resolved inputs. Member credit-batch ids are recorded in the snapshot
  // for audit but kept OUT of the hash: a pure-membership change must not
  // POST a duplicate Isometric Removal (the supplier ref carries the version).
  const semanticPayload = {
    removalId,
    templateId: ctx.defaultTemplate.id,
    sourceProductionRunIds: [...agg.sourceProductionRunIds].sort(),
    startedOn: agg.earliestStartTime.toISOString(),
    completedOn: agg.latestEndTime.toISOString(),
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
        template: ctx.defaultTemplate,
        blueprintsByKey,
        agg,
        externalProjectId,
        supersedePreviousId: null,
        resumed: true,
      });
    }
    case "create-new-version": {
      if (claim.reason === "rejected-hash-changed") {
        console.warn(
          "Removal retry will create a new version after rejected row with changed hash",
          { submissionId: latest!.id },
        );
      }
      const removalSupplierRef = buildRemovalSupplierRef({
        removalId,
        role: "removal",
        version: claim.nextVersion,
      });
      const datapointBodies = monitored.map((m) => {
        const supplierRefId = buildRemovalSupplierRef({
          removalId,
          role: "datapoint",
          version: claim.nextVersion,
          inputKey: `${m.removalTemplateComponentId}-${m.inputKey}`,
        });
        const draft = datapointBodyByKey.get(
          `${m.removalTemplateComponentId}::${m.inputKey}`,
        )!;
        return {
          rtcId: m.removalTemplateComponentId,
          inputKey: m.inputKey,
          body: { ...draft, supplier_reference_id: supplierRefId },
        };
      });

      const draftRow = await insertDraftSubmissionWithMappingLock(
        userId,
        {
          provider: ISOMETRIC_PROVIDER,
          submissionType: REMOVAL_SUBMISSION_TYPE,
          localEntityType: REMOVAL_ENTITY_TYPE,
          localEntityId: removalId,
          version: claim.nextVersion,
          payloadSnapshot: {
            semantic: semanticPayload,
            memberCreditBatchIds,
            transport: {
              removalSupplierRef,
              datapointBodies,
            },
          },
          payloadHash: semanticHash,
        },
        mappingGuard,
      );

      return runRemovalSubmission({
        userId,
        removalId,
        row: draftRow,
        transport: { removalSupplierRef, datapointBodies },
        fixed,
        template: ctx.defaultTemplate,
        blueprintsByKey,
        agg,
        externalProjectId,
        supersedePreviousId: claim.supersedePreviousId,
        resumed: false,
      });
    }
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
    console.warn("Failed to persist removal reporting window", {
      removalId,
      error: err instanceof Error ? err.message : String(err),
    });
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
        responsePayload: { id: externalRemovalId },
      },
      row.id,
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
        responsePayload: { id: externalId, source: "reconciliation" },
      },
      args.row.id,
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
        },
      },
      args.row.id,
    );
    return externalId;
  } catch (err) {
    const reconciled = await args.reconcile();
    if (reconciled.found) {
      await recordReconciled(reconciled.externalId);
      return reconciled.externalId;
    }

    const message = err instanceof Error ? err.message : String(err);
    await appendSyncEventBestEffort(
      args.userId,
      {
        ...baseEvent,
        operation: args.operation,
        status: "failed",
        requestPayload: args.requestPayload,
        errorMessage: message,
      },
      args.row.id,
    );
    await markSubmissionRejected(args.userId, args.row.id, {
      errorMessage: message,
    });
    throw new SafeError(`${args.failureMessagePrefix}: ${message}`);
  }
}

async function appendSyncEventBestEffort(
  userId: string,
  input: AppendSyncEventInput,
  submissionId: string,
): Promise<void> {
  try {
    await appendSyncEvent(userId, input);
  } catch (err) {
    console.warn("Failed to record certifier sync event", {
      operation: input.operation,
      submissionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function readRemovalTransport(
  row: CertificationSubmissionRow,
): RemovalTransportSnapshot {
  const snapshot = row.payloadSnapshot as
    | { transport?: Partial<RemovalTransportSnapshot> }
    | null;
  const transport = snapshot?.transport;
  if (
    !transport?.removalSupplierRef ||
    !Array.isArray(transport.datapointBodies)
  ) {
    throw new SafeError(
      "Stale submission cannot be resumed because its transport snapshot is missing.",
    );
  }
  return {
    removalSupplierRef: transport.removalSupplierRef,
    datapointBodies: transport.datapointBodies as DatapointTransport[],
  };
}
