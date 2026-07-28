import type { OrgContext } from "@/lib/auth/server";
import { appliedBiocharFraction } from "@/lib/certification/mass-accounting";
import { SafeError } from "@/lib/errors";
import { MISSING_VALUE, pluralize } from "@/lib/copy-utils";
import {
  aggregateProductionRuns,
  buildRemovalSupplierRef,
  enrichWithTransportLegs,
  type AggregatedProductionData,
  type CreateDatapointRequest,
  type IsometricComponentBlueprint,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import {
  buildCreateDatapointRequest,
  MAPPING_REVISION,
} from "@/lib/isometric/transformers/datapoint";
import {
  expectedSequestrationBlueprintKeys,
  isSequestrationBlueprintFamily,
} from "@/lib/isometric/transformers/measurement-sample";
import {
  assertSequestrationTemplateBindings,
  buildDirectSequestrationDatapoints,
  RegistryMappingError,
} from "@/lib/isometric/transformers/sequestration-binding";
import { weightedBatchChemistry } from "@/lib/isometric/utils/durability-aggregation";
import type { Logger } from "@/lib/log";
import {
  buildVersionedMeasurementSampleSubmissions,
  normalizeMeasurementSamplesForHash,
  type DurabilityMeasurementSampleClaimArgs,
} from "./durability-measurement-sample-snapshot";
import {
  assertRemovalDatesNotFuture,
  assertReportingWindowNotInverted,
  resolveLatestApplicationTime,
} from "./removal-reporting-window";
import type { ResolvedFixedInput } from "./removal-snapshot-readers";
import {
  collectCandidateSourceDocumentsForRemoval,
  resolveSourceBindingCandidates,
  type CandidateSourceDocument,
  type ResolvedSourceBindingCandidate,
} from "./sources";
import type { RemovalSubmissionContext } from "./certify-context-core";
import {
  buildRemovalSourceBindingPlan,
  sourceIdsForDatapointTarget,
  type RemovalSourceBindingPlanEntry,
} from "@/lib/certification/removal-source-bindings";

export interface ResolvedMonitoredInput {
  removalTemplateComponentId: string;
  componentBlueprintKey: string;
  componentDisplayName?: string;
  inputKey: string;
  quantity: { magnitude: number; unit: string };
  datapointType: string;
}

export interface ResolvedTemplateInputs {
  monitored: ResolvedMonitoredInput[];
  fixed: ResolvedFixedInput[];
  datapointBodyByKey: Map<string, CreateDatapointRequest>;
}

export interface RemovalSubmissionBuild {
  agg: AggregatedProductionData;
  latestApplicationTime: Date;
  candidateDocumentIds: string[];
  candidateSourceDocuments: CandidateSourceDocument[];
  sourceIds: string[];
  sourceBindingPlan: RemovalSourceBindingPlanEntry[];
  semanticPayload: Record<string, unknown>;
  monitored: ResolvedMonitoredInput[];
  fixed: ResolvedFixedInput[];
  datapointBodyByKey: Map<string, CreateDatapointRequest>;
  durabilityMeasurementSampleArgs: DurabilityMeasurementSampleClaimArgs | null;
  memberCreditBatchIds: string[];
}

export interface RemovalSubmissionReview {
  template: {
    id: string;
    displayName: string;
    mappingRevision: string;
  };
  bindings: Array<{
    componentId: string;
    componentBlueprintKey: string;
    componentDisplayName?: string;
    inputKey: string;
    binding: "monitored" | "fixed" | "measurement-sample";
    wireMagnitude?: number;
    wireUnit?: string;
    wireType?: string;
    fixedDatapointId?: string;
  }>;
  measurementSamples: Array<{
    operationKey: string;
    label: string;
    measuredAt: string | null;
    values: unknown[];
  }>;
  directSequestrationDatapoints: Array<{
    componentId: string;
    inputKey: string;
    magnitude: number;
    unit: string;
    type: string;
  }>;
  sourceIds: string[];
  /** Candidate files whose Source IDs are materialized during submission. */
  pendingSourceCount?: number;
  intendedPostTargets: string[];
  memberCreditBatches: Array<{ id: string; code: string }>;
  productionRuns: Array<{ id: string; code: string | null }>;
  reportingWindow: { startedOn: string; completedOn: string };
}

export interface CompiledRemovalSubmission {
  review: RemovalSubmissionReview;
  transportPlan: RemovalSubmissionBuild | null;
  blockers: string[];
  warnings: string[];
  snapshot: {
    materialization: "claim-time";
    mappingRevision: string;
    semanticPayload: Record<string, unknown>;
  } | null;
}

export interface MaterializedRemovalSubmissionSnapshot {
  payloadSnapshot: {
    __mappingRevision: string;
    semantic: Record<string, unknown>;
    memberCreditBatchIds: string[];
    sourceBindingPlan: RemovalSourceBindingPlanEntry[];
    transport: {
      removalSupplierRef: string;
      datapointBodies: Array<{
        rtcId: string;
        inputKey: string;
        body: CreateDatapointRequest;
      }>;
    };
    durabilityMeasurementSamples?: {
      submissions: ReturnType<
        typeof buildVersionedMeasurementSampleSubmissions
      >;
    };
  };
}

const DATAPOINT_POST_TARGET = "/datapoints";
const MEASUREMENT_SAMPLE_POST_TARGET = "/measurement-samples";
const GHG_ENTRY_POST_TARGET = "/ghg-entries";
const LEGACY_SEQUESTRATION_BLUEPRINT =
  "carbon_rich_substance_sequestration";

function hasSupportedSequestrationComponent(
  template: IsometricGhgEntryTemplate,
): boolean {
  return (template.groups ?? []).some((group) =>
    group.components.some(
      (component) =>
        component.blueprint_key === LEGACY_SEQUESTRATION_BLUEPRINT ||
        isSequestrationBlueprintFamily(component.blueprint_key),
    ),
  );
}

function emptyReview(
  template: IsometricGhgEntryTemplate,
): RemovalSubmissionReview {
  return {
    template: {
      id: template.id,
      displayName: template.display_name,
      mappingRevision: MAPPING_REVISION,
    },
    bindings: [],
    measurementSamples: [],
    directSequestrationDatapoints: [],
    sourceIds: [],
    pendingSourceCount: 0,
    intendedPostTargets: [],
    memberCreditBatches: [],
    productionRuns: [],
    reportingWindow: { startedOn: "", completedOn: "" },
  };
}

export function removalTemplateTierCompatibilityBlocker(
  ctx: Pick<RemovalSubmissionContext, "batchesWithSamples">,
  template: IsometricGhgEntryTemplate,
): string | null {
  const facilityTier = ctx.batchesWithSamples[0]?.durabilityOption ?? null;
  if (!facilityTier) return null;
  const expectedKeys = expectedSequestrationBlueprintKeys(facilityTier);
  const mismatched = template.groups
    .flatMap((group) => group.components)
    .map((component) => component.blueprint_key)
    .filter(isSequestrationBlueprintFamily)
    .find((key) => !expectedKeys.has(key));
  if (!mismatched) return null;

  const tierLabel = facilityTier === "1000_year" ? "1000-year" : "200-year";
  return (
    `This facility uses ${tierLabel} durability, but its default Removal ` +
    `template uses an incompatible storage component (${mismatched}). ` +
    `Choose a ${tierLabel} template or change the facility's durability tier.`
  );
}

/**
 * Deep compile interface for the Removal workflow. Template walking, semantic
 * mappings, transforms and request planning stay behind this function. The
 * returned snapshot is explicitly a claim-time materialization plan; it is not
 * an immutable versioned POST snapshot until the ledger claim supplies a
 * version.
 */
export async function compileRemovalSubmission(
  args: Parameters<typeof buildRemovalSubmissionBuild>[0] & {
    /**
     * Review-time compilation may include candidate files that submission will
     * mirror. The submit path recompiles strictly after those mirrors persist.
     */
    allowPendingSources?: boolean;
  },
): Promise<CompiledRemovalSubmission> {
  if (
    args.ctx.entityReadinessGaps?.length === 0 &&
    !hasSupportedSequestrationComponent(args.defaultTemplate)
  ) {
    return {
      review: emptyReview(args.defaultTemplate),
      transportPlan: null,
      blockers: [
        "The default Removal template has no supported biochar sequestration component. Rebind a complete Removal template before submitting.",
      ],
      warnings: [...(args.ctx.submissionWarnings ?? [])],
      snapshot: null,
    };
  }

  let build: RemovalSubmissionBuild;
  try {
    build = await buildRemovalSubmissionBuild(args);
  } catch (error) {
    if (error instanceof RegistryMappingError) {
      args.log?.error(
        {
          groupKey: error.groupKey,
          blueprintKey: error.blueprintKey,
          inputKey: error.inputKey,
        },
        "removal registry mapping is unsupported",
      );
    }
    return {
      review: emptyReview(args.defaultTemplate),
      transportPlan: null,
      blockers: [
        error instanceof SafeError
          ? error.message
          : "Removal submission could not be compiled from the current source data.",
      ],
      warnings: [...(args.ctx.submissionWarnings ?? [])],
      snapshot: null,
    };
  }

  const blockers: string[] = [];
  const readySourceDocumentCount =
    build.sourceBindingPlan.length > 0
      ? build.sourceBindingPlan.length
      : build.sourceIds.length;
  const pendingSourceCount = Math.max(
    build.candidateDocumentIds.length - readySourceDocumentCount,
    0,
  );
  const tierBlocker = removalTemplateTierCompatibilityBlocker(
    args.ctx,
    args.defaultTemplate,
  );
  if (tierBlocker) blockers.push(tierBlocker);
  if (build.candidateDocumentIds.length === 0) {
    blockers.push(
      "Removal submission requires at least one supporting evidence file.",
    );
  }
  if (
    !args.allowPendingSources &&
    pendingSourceCount > 0
  ) {
    blockers.push(
      `Only ${readySourceDocumentCount} of ${build.candidateDocumentIds.length} supporting files reached the registry. Submit again to retry the rest.`,
    );
  }

  const semanticSamples = build.durabilityMeasurementSampleArgs
    ? normalizeMeasurementSamplesForHash(
        buildVersionedMeasurementSampleSubmissions({
          ...build.durabilityMeasurementSampleArgs,
          version: 1,
        }),
      )
    : [];
  const measurementSamples = semanticSamples.map((sample) => {
    const body = sample.body as {
      measured_at?: unknown;
      values?: unknown;
    };
    return {
      operationKey: sample.operationKey,
      label: sample.label,
      measuredAt:
        typeof body.measured_at === "string" ? body.measured_at : null,
      values: Array.isArray(body.values) ? body.values : [],
    };
  });

  const templateComponentById = new Map(
    args.defaultTemplate.groups
      .flatMap((group) => group.components)
      .map((component) => [component.id, component] as const),
  );
  const bindings: RemovalSubmissionReview["bindings"] = [
    ...build.monitored.map((input) => ({
      componentId: input.removalTemplateComponentId,
      componentBlueprintKey: input.componentBlueprintKey,
      componentDisplayName: input.componentDisplayName,
      inputKey: input.inputKey,
      binding: "monitored" as const,
      wireMagnitude: input.quantity.magnitude,
      wireUnit: input.quantity.unit,
      wireType: input.datapointType,
    })),
    ...build.fixed.map((input) => ({
      componentId: input.removalTemplateComponentId,
      componentBlueprintKey:
        templateComponentById.get(input.removalTemplateComponentId)
          ?.blueprint_key ?? MISSING_VALUE.notAvailable,
      componentDisplayName: templateComponentById.get(
        input.removalTemplateComponentId,
      )?.display_name,
      inputKey: input.inputKey,
      binding: "fixed" as const,
      fixedDatapointId: input.preboundDatapointId,
    })),
    ...args.defaultTemplate.groups.flatMap((group) =>
      group.components
        .filter((component) =>
          isSequestrationBlueprintFamily(component.blueprint_key),
        )
        .flatMap((component) =>
          component.inputs.map((input) => ({
            componentId: component.id,
            componentBlueprintKey: component.blueprint_key,
            componentDisplayName: component.display_name,
            inputKey: input.input_key,
            binding: "measurement-sample" as const,
          })),
        ),
    ),
  ].sort((left, right) =>
    `${left.componentId}::${left.inputKey}`.localeCompare(
      `${right.componentId}::${right.inputKey}`,
    ),
  );

  const directSequestrationDatapoints =
    build.durabilityMeasurementSampleArgs
      ? buildDirectSequestrationDatapoints({
          template: args.defaultTemplate,
          measurementSampleSubmissions:
            buildVersionedMeasurementSampleSubmissions({
              ...build.durabilityMeasurementSampleArgs,
              version: 1,
            }),
          projectId: args.externalProjectId,
          removalId: args.removalId,
          version: 1,
          sourceIds: [],
        }).map((datapoint) => ({
          componentId: datapoint.rtcId,
          inputKey: datapoint.inputKey,
          magnitude: datapoint.body.quantity.magnitude,
          unit: datapoint.body.quantity.unit ?? "",
          type: datapoint.body.type,
        }))
      : [];

  const review: RemovalSubmissionReview = {
    template: {
      id: args.defaultTemplate.id,
      displayName: args.defaultTemplate.display_name,
      mappingRevision: MAPPING_REVISION,
    },
    bindings,
    measurementSamples,
    directSequestrationDatapoints,
    sourceIds: [...build.sourceIds],
    pendingSourceCount,
    intendedPostTargets: [
      ...(build.monitored.length > 0 ||
      directSequestrationDatapoints.length > 0
        ? [DATAPOINT_POST_TARGET]
        : []),
      ...(measurementSamples.length > 0
        ? [MEASUREMENT_SAMPLE_POST_TARGET]
        : []),
      GHG_ENTRY_POST_TARGET,
    ],
    memberCreditBatches: args.ctx.memberBatches.map((batch) => ({
      id: batch.id,
      code: batch.code,
    })),
    productionRuns: args.ctx.runs.map((run) => ({
      id: run.id,
      code: "code" in run && typeof run.code === "string" ? run.code : null,
    })),
    reportingWindow: {
      startedOn: build.agg.earliestStartTime.toISOString(),
      completedOn: build.latestApplicationTime.toISOString(),
    },
  };

  return {
    review,
    transportPlan: blockers.length === 0 ? build : null,
    blockers,
    warnings: [...(args.ctx.submissionWarnings ?? [])],
    snapshot:
      blockers.length === 0
        ? {
            materialization: "claim-time",
            mappingRevision: MAPPING_REVISION,
            semanticPayload: build.semanticPayload,
          }
        : null,
  };
}

/**
 * Materialize the claim-versioned immutable snapshot from a successful
 * compilation. This is the only place supplier refs are assigned a ledger
 * version, and its output is the exact source consumed by the POST phase.
 */
export function materializeRemovalSubmissionSnapshot(args: {
  compiled: RemovalSubmissionBuild;
  template: IsometricGhgEntryTemplate;
  externalProjectId: string;
  removalId: string;
  nextVersion: number;
}): MaterializedRemovalSubmissionSnapshot {
  const {
    compiled,
    template,
    externalProjectId,
    removalId,
    nextVersion,
  } = args;
  const removalSupplierRef = buildRemovalSupplierRef({
    removalId,
    role: "removal",
    version: nextVersion,
  });
  const finalDatapointBodies = compiled.monitored.map((input) => {
    const supplierRefId = buildRemovalSupplierRef({
      removalId,
      role: "datapoint",
      version: nextVersion,
      inputKey: `${input.removalTemplateComponentId}-${input.inputKey}`,
    });
    const draftKey = `${input.removalTemplateComponentId}::${input.inputKey}`;
    const draft = compiled.datapointBodyByKey.get(draftKey);
    if (!draft) {
      throw new SafeError(
        `Registry field ${input.inputKey} in component ${input.removalTemplateComponentId} could not be prepared. Refresh the page and compile the Removal again.`,
      );
    }
    return {
      rtcId: input.removalTemplateComponentId,
      inputKey: input.inputKey,
      body: { ...draft, supplier_reference_id: supplierRefId },
    };
  });
  const durabilityMeasurementSamples =
    compiled.durabilityMeasurementSampleArgs
      ? {
          submissions: buildVersionedMeasurementSampleSubmissions({
            ...compiled.durabilityMeasurementSampleArgs,
            version: nextVersion,
          }),
        }
      : undefined;
  const directSequestrationDatapoints = durabilityMeasurementSamples
    ? buildDirectSequestrationDatapoints({
        template,
        measurementSampleSubmissions:
          durabilityMeasurementSamples.submissions,
        projectId: externalProjectId,
        removalId,
        version: nextVersion,
        sourceIds: [],
      })
    : [];

  return {
    payloadSnapshot: {
      __mappingRevision: MAPPING_REVISION,
      semantic: compiled.semanticPayload,
      memberCreditBatchIds: compiled.memberCreditBatchIds,
      sourceBindingPlan: compiled.sourceBindingPlan,
      transport: {
        removalSupplierRef,
        datapointBodies: [
          ...finalDatapointBodies,
          ...directSequestrationDatapoints,
        ],
      },
      ...(durabilityMeasurementSamples
        ? { durabilityMeasurementSamples }
        : {}),
    },
  };
}

export function normalizeSequestrationTemplateForHash(
  template: IsometricGhgEntryTemplate,
) {
  return template.groups
    .flatMap((group) =>
      group.components
        .filter((component) =>
          isSequestrationBlueprintFamily(component.blueprint_key),
        )
        .map((component) => ({
          groupKey: group.key,
          rtcId: component.id,
          blueprintKey: component.blueprint_key,
          inputs: component.inputs
            .map((input) => ({
              inputKey: input.input_key,
              type: input.type,
              quantityKind: input.quantity_kind,
              datapointId: input.datapoint_id,
            }))
            .sort((a, b) => a.inputKey.localeCompare(b.inputKey)),
        })),
    )
    .sort((a, b) =>
      `${a.groupKey}::${a.rtcId}::${a.blueprintKey}`.localeCompare(
        `${b.groupKey}::${b.rtcId}::${b.blueprintKey}`,
      ),
    );
}

export function assertEntityReadinessGapsResolved(
  entityReadinessGaps: string[] | undefined,
): void {
  if (!entityReadinessGaps) {
    throw new SafeError(
      "The Removal review did not finish. Refresh the review before submitting.",
    );
  }
  if (entityReadinessGaps.length === 0) return;

  throw new SafeError(
    `Complete these fields before submitting the Removal:\n${entityReadinessGaps.join("\n")}`,
  );
}

export async function buildRemovalSubmissionBuild(args: {
  orgCtx: OrgContext;
  removalId: string;
  ctx: RemovalSubmissionContext;
  defaultTemplate: IsometricGhgEntryTemplate;
  blueprintsByKey: Map<string, IsometricComponentBlueprint>;
  externalProjectId: string;
  allowPeriodInputStub: boolean;
  hasDurabilityComponents: boolean;
  log?: Logger;
  sourceIds?: string[];
  candidateDocumentIds?: string[];
  sourceBindingCandidates?: ResolvedSourceBindingCandidate[];
  candidateSourceDocuments?: CandidateSourceDocument[];
}): Promise<RemovalSubmissionBuild> {
  const {
    orgCtx,
    removalId,
    ctx,
    defaultTemplate,
    blueprintsByKey,
    externalProjectId,
    allowPeriodInputStub,
    hasDurabilityComponents,
    log,
  } = args;

  assertEntityReadinessGapsResolved(ctx.entityReadinessGaps);
  assertSequestrationTemplateBindings(defaultTemplate);

  const lineageWarnings: string[] = [];
  for (const lineage of ctx.lineages) {
    lineageWarnings.push(
      ...lineage.warnings.map(
        (warning) => `Application ${lineage.application.code}: ${warning}`,
      ),
    );
    if (!lineage.productionRun) {
      throw new SafeError(
        `Application ${lineage.application.code} has no linked production run. Link a production run before submitting.`,
      );
    }
  }
  if (lineageWarnings.length > 0) {
    throw new SafeError(
      `Complete the Removal traceability before submitting:\n${lineageWarnings.join("\n")}`,
    );
  }
  if (ctx.runs.length === 0) {
    throw new SafeError(
      "This Removal's credit batches have no production runs. Add production runs before submitting.",
    );
  }

  const baseAgg = {
    ...aggregateProductionRuns(ctx.runs, ctx.attributionByRunId),
    ...weightedBatchChemistry(ctx.batchesWithSamples, ctx.attributionByRunId),
  };
  if (baseAgg.warnings.length > 0) {
    throw new SafeError(
      `Removal submission blocked:\n${baseAgg.warnings.join("\n")}`,
    );
  }

  if (ctx.durabilityGateBlockers.length > 0) {
    throw new SafeError(
      `Resolve these Sample and eligibility issues before submitting:\n${ctx.durabilityGateBlockers.join("\n")}`,
    );
  }

  const transportAgg = enrichWithTransportLegs(baseAgg, ctx.transportLegs, {
    appliedBiocharFraction: appliedBiocharFraction(ctx.runSummary),
  });
  const transportWarnings = transportAgg.warnings.slice(baseAgg.warnings.length);
  if (transportWarnings.length > 0) {
    throw new SafeError(
      `Resolve these transport issues before submitting:\n${transportWarnings.join("\n")}`,
    );
  }

  const agg = transportAgg;
  const latestApplicationTime = resolveLatestApplicationTime(ctx.lineages);
  assertReportingWindowNotInverted({
    lineages: ctx.lineages,
    runStartTimeByRunId: new Map(
      ctx.runs.map((run) => [run.id, run.startTime]),
    ),
  });
  assertRemovalDatesNotFuture({
    productionEndTime: agg.latestEndTime,
    latestApplicationTime,
  });

  if (ctx.submissionWarnings.length > 0) {
    log?.warn(
      { submissionWarnings: ctx.submissionWarnings },
      "removal has non-blocking submission warnings",
    );
  }

  // A caller-supplied Source set makes this a side-effect-free preflight or a
  // locked rebuild. Skip the document walk in that case; the caller already
  // owns the authoritative IDs and does not consume `candidateDocumentIds`.
  const candidateSourceDocuments =
    args.candidateSourceDocuments ??
    (args.sourceIds || args.sourceBindingCandidates
      ? []
      : await collectCandidateSourceDocumentsForRemoval(orgCtx, {
          lineages: ctx.lineages,
        }));
  const sourceBindingCandidates =
    args.sourceBindingCandidates ??
    (args.sourceIds
      ? []
      : await resolveSourceBindingCandidates(orgCtx, {
          candidates: candidateSourceDocuments,
        }));
  const candidateDocumentIds =
    args.candidateDocumentIds ??
    candidateSourceDocuments.map((candidate) => candidate.documentId);
  const sourceIds =
    args.sourceIds ??
    Array.from(
      new Set(sourceBindingCandidates.map((candidate) => candidate.sourceId)),
    ).sort();
  const sourceIdByDocumentId = new Map(
    sourceBindingCandidates.map((candidate) => [
      candidate.documentId,
      candidate.sourceId,
    ]),
  );
  const sourceBindingPlan = buildRemovalSourceBindingPlan({
    candidates: sourceBindingCandidates,
    template: defaultTemplate,
    applicationIdsByCreditBatchId: new Map(
      ctx.memberBatchClaims.map((batch) => [
        batch.creditBatchId,
        batch.applicationIds,
      ]),
    ),
  });
  // The operator reviews every candidate file before pending Sources receive
  // registry IDs. Build the semantic plan from that complete candidate set,
  // using an empty placeholder only for IDs that submission will materialize.
  // `reviewPayloadHash` strips those IDs, so the reviewed and post-mirror plans
  // compare identically while every role, lineage and intended target remains
  // covered. The operational plan above stays strict and contains ready Sources
  // only, so no empty ID can reach a wire payload.
  const semanticSourceBindingPlan = buildRemovalSourceBindingPlan({
    candidates: candidateSourceDocuments.map((candidate) => ({
      ...candidate,
      sourceId: sourceIdByDocumentId.get(candidate.documentId) ?? "",
    })),
    template: defaultTemplate,
    applicationIdsByCreditBatchId: new Map(
      ctx.memberBatchClaims.map((batch) => [
        batch.creditBatchId,
        batch.applicationIds,
      ]),
    ),
  });

  const { monitored, fixed, datapointBodyByKey } = resolveTemplateInputs({
    template: defaultTemplate,
    blueprintsByKey,
    agg,
    externalProjectId,
    sourceIds,
    sourceBindingPlan,
    allowPeriodInputStub,
  });
  const hasOnly1000YearBatches =
    ctx.batchesWithSamples.length > 0 &&
    ctx.batchesWithSamples.every(
      (batch) => batch.durabilityOption === "1000_year",
    );
  const durabilityMeasurementSampleArgs =
    hasDurabilityComponents &&
    (hasOnly1000YearBatches || ctx.facilityReferenceSoilTemperature)
      ? {
          removalId,
          externalProjectId,
          batches: ctx.batchesWithSamples,
          attributionByRunId: ctx.attributionByRunId,
          facilityReferenceSoilTemperature:
            ctx.facilityReferenceSoilTemperature ?? null,
          measuredAt: agg.latestEndTime.toISOString(),
        }
      : null;
  const semanticMeasurementSamples = durabilityMeasurementSampleArgs
    ? normalizeMeasurementSamplesForHash(
        buildVersionedMeasurementSampleSubmissions({
          ...durabilityMeasurementSampleArgs,
          // Supplier refs are excluded by normalizeMeasurementSamplesForHash.
          // Avoid manufacturing a misleading `v0` preview before claim time.
          version: 1,
        }),
      )
    : [];

  const semanticPayload = {
    removalId,
    mappingRevision: MAPPING_REVISION,
    externalProjectId,
    templateId: defaultTemplate.id,
    sequestrationTemplate: normalizeSequestrationTemplateForHash(
      defaultTemplate,
    ),
    sourceProductionRunIds: [...agg.sourceProductionRunIds].sort(),
    startedOn: agg.earliestStartTime.toISOString(),
    completedOn: latestApplicationTime.toISOString(),
    sourceIds,
    sourceBindingPlan: semanticSourceBindingPlan,
    candidateSources: candidateSourceDocuments
      .map((candidate) => ({
        documentId: candidate.documentId,
        binding: candidate.binding,
      }))
      .sort((left, right) =>
        left.documentId.localeCompare(right.documentId),
      ),
    ...(semanticMeasurementSamples.length > 0
      ? { durabilityMeasurementSamples: semanticMeasurementSamples }
      : {}),
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
  const memberCreditBatchIds = ctx.memberBatches
    .map((b) => b.id)
    .sort((a, b) => a.localeCompare(b));

  return {
    agg,
    latestApplicationTime,
    candidateDocumentIds,
    candidateSourceDocuments,
    sourceIds,
    sourceBindingPlan,
    semanticPayload,
    monitored,
    fixed,
    datapointBodyByKey,
    durabilityMeasurementSampleArgs,
    memberCreditBatchIds,
  };
}

// Walks the removal template's components, classifying every input as a
// monitored datapoint (built from the aggregation) or a pre-bound fixed datapoint.
function resolveTemplateInputs(args: {
  template: IsometricGhgEntryTemplate;
  blueprintsByKey: Map<string, IsometricComponentBlueprint>;
  agg: AggregatedProductionData;
  externalProjectId: string;
  sourceIds: string[];
  sourceBindingPlan: RemovalSourceBindingPlanEntry[];
  allowPeriodInputStub: boolean;
}): ResolvedTemplateInputs {
  const {
    template,
    blueprintsByKey,
    agg,
    externalProjectId,
    sourceIds,
    sourceBindingPlan,
    allowPeriodInputStub,
  } = args;

  const monitored: ResolvedMonitoredInput[] = [];
  const fixed: ResolvedFixedInput[] = [];
  const datapointBodyByKey = new Map<string, CreateDatapointRequest>();
  const unboundFixedInputs: { component: string; inputKey: string }[] = [];

  for (const group of template.groups) {
    for (const component of group.components) {
      // EVERY sequestration component (200-year sampled/unsampled + 1000-year,
      // and any unknown variant) is fed by the measurement-samples step
      // (Phase 3), NOT the aggregation→datapoint loop, so skip it here — its
      // inputs have no INPUT_MAPPING entry (skipping via the FAMILY predicate is
      // what kills the misleading "no INPUT_MAPPING entry … update
      // transformers/datapoint.ts" error for a 1000-year template), and
      // buildCreateGhgEntryRequest binds the response datapoint IDs explicitly.
      // The submit-time template↔tier guard fails closed on a sequestration
      // component outside the facility tier's expected set.
      if (isSequestrationBlueprintFamily(component.blueprint_key)) continue;
      const blueprint = blueprintsByKey.get(component.blueprint_key);
      if (!blueprint) {
        throw new SafeError(
          `Registry template component "${component.display_name}" is not available. Refresh the facility link in settings.`,
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
            `Registry template component "${blueprint.key}" is missing a required field. Ask an Admin to update the template.`,
          );
        }
        const draft = buildCreateDatapointRequest({
          groupKey: group.key,
          componentBlueprintKey: component.blueprint_key,
          componentDisplayName: component.display_name,
          rtcInput,
          blueprintInput,
          agg,
          projectId: externalProjectId,
          supplierRefId: "__placeholder__",
          sourceIds:
            sourceBindingPlan.length > 0
              ? sourceIdsForDatapointTarget(sourceBindingPlan, {
                  componentId: component.id,
                  inputKey: rtcInput.input_key,
                })
              : sourceIds,
          allowPeriodInputStub,
        });
        monitored.push({
          removalTemplateComponentId: component.id,
          componentBlueprintKey: component.blueprint_key,
          componentDisplayName: component.display_name,
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
    const components = Array.from(
      new Set(unboundFixedInputs.map((input) => input.component)),
    ).join(", ");
    throw new SafeError(
      `Removal template "${template.display_name}" has ${unboundFixedInputs.length} fixed ${pluralize(unboundFixedInputs.length, "value")} missing in ${components}. Set each value in the Isometric template editor before submitting.`,
    );
  }

  return { monitored, fixed, datapointBodyByKey };
}
