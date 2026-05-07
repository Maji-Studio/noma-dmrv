"use server";

import {
  appendSyncEvent,
  type AppendSyncEventInput,
  getLatestSubmission,
  insertDraftSubmissionWithMappingLock,
  listRecentSyncEvents,
  LOCK_TTL_MS,
  markSubmissionRejected,
  markSubmissionSubmitted,
  resetSubmissionToDraftWithMappingLock,
  type CertificationSubmissionRow,
  type CertifierSyncEventRow,
  type MappingClaimGuard,
} from "@/data-access/certification";
import { getChainOfCustodyData } from "@/data-access/chain-of-custody";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
import { SafeError } from "@/lib/errors";
import {
  aggregateProductionRuns,
  buildSupplierRef,
  createDatapoint,
  createRemoval,
  decideSubmissionClaim,
  payloadHash,
  reconcileDatapoint,
  reconcileRemoval,
  type CreateDatapointRequest,
  type IsometricComponentBlueprint,
  type IsometricRemovalTemplate,
} from "@/lib/isometric";
import {
  buildCreateDatapointRequest,
  INPUT_MAPPING,
} from "@/lib/isometric/transformers/datapoint";
import { buildCreateRemovalRequest } from "@/lib/isometric/transformers/removal";
import {
  submitCreditBatchSchema,
  type SubmitCreditBatchInput,
} from "@/schemas/certification";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadCertifyContextForCreditBatchForUser } from "./certify-context";
import {
  assertProductionConfirmed,
  CREDIT_BATCH_ENTITY_TYPE,
  ISOMETRIC_PROVIDER,
  REMOVAL_SUBMISSION_TYPE,
} from "./shared";

export interface SubmitCreditBatchResult {
  externalId: string;
  version: number;
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

interface RunRemovalSubmissionArgs {
  userId: string;
  creditBatchId: string;
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

export async function submitCreditBatch(
  input: SubmitCreditBatchInput | string,
): Promise<ActionResult<SubmitCreditBatchResult>> {
  return withAction(async (userId) => {
    const parsed = submitCreditBatchSchema.parse(
      typeof input === "string" ? { creditBatchId: input } : input,
    );

    const ctx = await loadCertifyContextForCreditBatchForUser(
      userId,
      parsed.creditBatchId,
    );
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

    assertProductionConfirmed(parsed.confirmProduction);

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

    const creditBatch = await getCreditBatchById(userId, parsed.creditBatchId);
    if (!creditBatch) throw new SafeError("Credit batch not found");
    if (creditBatch.applicationIds.length === 0) {
      throw new SafeError("Credit batch has no linked applications.");
    }

    const lineageWarnings: string[] = [];
    const productionRunIds = new Set<string>();
    for (const applicationId of creditBatch.applicationIds) {
      const lineage = await getChainOfCustodyData(userId, applicationId);
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
      productionRunIds.add(lineage.productionRun.id);
    }
    if (lineageWarnings.length > 0) {
      throw new SafeError(
        `Lineage incomplete for submission:\n${lineageWarnings.join("\n")}`,
      );
    }

    const runs = await getProductionRunsWithSamples(
      userId,
      Array.from(productionRunIds),
    );
    if (runs.length === 0) {
      throw new SafeError(
        "Production runs not found for the credit batch's applications.",
      );
    }
    const agg = aggregateProductionRuns(runs);
    if (agg.warnings.length > 0) {
      throw new SafeError(
        `Aggregation warnings — submission blocked:\n${agg.warnings.join("\n")}`,
      );
    }

    const monitored: ResolvedMonitoredInput[] = [];
    const fixed: ResolvedFixedInput[] = [];
    const datapointBodyByKey = new Map<string, CreateDatapointRequest>();

    for (const group of ctx.defaultTemplate.groups) {
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
              throw new SafeError(
                `Template "${ctx.defaultTemplate.display_name}" has a fixed input "${rtcInput.input_key}" on component "${component.display_name}" without a pre-bound datapoint. Bind a constant for this input in the Isometric template editor before submitting.`,
              );
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
          const mapping = INPUT_MAPPING[rtcInput.input_key];
          if (!mapping) {
            throw new SafeError(
              `No INPUT_MAPPING entry for input "${rtcInput.input_key}".`,
            );
          }
          const raw = agg[mapping.source];
          if (raw == null) {
            throw new SafeError(
              `Aggregated source ${String(mapping.source)} for input "${rtcInput.input_key}" is null.`,
            );
          }
          const draft = buildCreateDatapointRequest({
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
          datapointBodyByKey.set(
            `${component.id}::${rtcInput.input_key}`,
            draft,
          );
        }
      }
    }

    const semanticPayload = {
      templateId: ctx.defaultTemplate.id,
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

    const latest = await getLatestSubmission(userId, {
      provider: ISOMETRIC_PROVIDER,
      submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: CREDIT_BATCH_ENTITY_TYPE,
      localEntityId: parsed.creditBatchId,
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
        throw new SafeError("Submission already in progress");
      case "blocked-rejected-with-external":
        throw new SafeError(
          "This Removal was rejected by the verifier. Resolve the rejection in the Isometric registry before retrying.",
        );
      case "invalid-changed-hash":
        // Removal policy is `supersede`; this branch is unreachable but kept
        // for exhaustiveness so future policy changes are explicit.
        throw new SafeError("Unexpected submission state for credit batch.");
      case "return-existing":
        return { externalId: claim.externalId, version: claim.version };
      case "resume": {
        const row = await resetSubmissionToDraftWithMappingLock(
          userId,
          claim.resumeRowId,
          mappingGuard,
        );
        const transport = readRemovalTransport(row);
        return runRemovalSubmission({
          userId,
          creditBatchId: parsed.creditBatchId,
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
          // latest is non-null whenever reason !== 'first'; the assertion
          // is safe here.
          console.warn(
            "Removal retry will create a new version after rejected row with changed hash",
            { submissionId: latest!.id },
          );
        }
        const removalSupplierRef = buildSupplierRef({
          creditBatchId: parsed.creditBatchId,
          role: "removal",
          version: claim.nextVersion,
        });
        const datapointBodies = monitored.map((m) => {
          const supplierRefId = buildSupplierRef({
            creditBatchId: parsed.creditBatchId,
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
            localEntityType: CREDIT_BATCH_ENTITY_TYPE,
            localEntityId: parsed.creditBatchId,
            version: claim.nextVersion,
            payloadSnapshot: {
              semantic: semanticPayload,
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
          creditBatchId: parsed.creditBatchId,
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
  });
}

export interface CreditBatchSubmissionState {
  latest: CertificationSubmissionRow | null;
  recentSyncEvents: CertifierSyncEventRow[];
  isLockedInFlight: boolean;
}

export async function loadCreditBatchSubmissionState(
  creditBatchId: string,
): Promise<ActionResult<CreditBatchSubmissionState>> {
  return withAction(async (userId) => {
    const [latest, recentSyncEvents] = await Promise.all([
      getLatestSubmission(userId, {
        provider: ISOMETRIC_PROVIDER,
        submissionType: REMOVAL_SUBMISSION_TYPE,
        localEntityType: CREDIT_BATCH_ENTITY_TYPE,
        localEntityId: creditBatchId,
      }),
      listRecentSyncEvents(userId, {
        entityType: CREDIT_BATCH_ENTITY_TYPE,
        entityId: creditBatchId,
        limit: 10,
      }),
    ]);

    const lockedAtMs = latest?.lockedAt?.getTime() ?? 0;
    const isLockedInFlight =
      latest?.status === "draft" && Date.now() - lockedAtMs < LOCK_TTL_MS;

    return { latest, recentSyncEvents, isLockedInFlight };
  });
}

async function runRemovalSubmission({
  userId,
  creditBatchId,
  row,
  transport,
  fixed,
  template,
  blueprintsByKey,
  agg,
  externalProjectId,
  supersedePreviousId,
  resumed,
}: RunRemovalSubmissionArgs): Promise<SubmitCreditBatchResult> {
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
      creditBatchId,
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
  const removalId = await createOrReconcile({
    userId,
    creditBatchId,
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
    externalId: removalId,
    supersedePreviousId,
  });

  if (resumed) {
    await appendSyncEventBestEffort(
      userId,
      {
        provider: ISOMETRIC_PROVIDER,
        entityType: CREDIT_BATCH_ENTITY_TYPE,
        entityId: creditBatchId,
        operation: "removal:create:resumed",
        status: "succeeded",
        responsePayload: { id: removalId },
      },
      row.id,
    );
  }

  return { externalId: removalId, version: row.version };
}

interface CreateOrReconcileArgs {
  userId: string;
  creditBatchId: string;
  row: CertificationSubmissionRow;
  operation: string;
  requestPayload: unknown;
  supplierRefId: string;
  resumed: boolean;
  create: () => Promise<string>;
  reconcile: () => Promise<{ found: true; externalId: string } | { found: false }>;
  failureMessagePrefix: string;
}

async function createOrReconcile(
  args: CreateOrReconcileArgs,
): Promise<string> {
  const baseEvent = {
    provider: ISOMETRIC_PROVIDER,
    entityType: CREDIT_BATCH_ENTITY_TYPE,
    entityId: args.creditBatchId,
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
