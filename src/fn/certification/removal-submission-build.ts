import type { OrgContext } from "@/lib/auth/server";
import { env } from "@/config/env";
import { appliedBiocharFraction } from "@/lib/certification/mass-accounting";
import { SafeError } from "@/lib/errors";
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  aggregateProductionRuns,
  buildRemovalSupplierRef,
  enrichWithTransportLegs,
  type AggregatedProductionData,
  type CreateDatapointRequest,
  type IsometricComponentBlueprint,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import { MAPPING_REVISION } from "@/lib/isometric/transformers/datapoint";
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
import { buildBiocharApplicationReference } from "@/lib/isometric/biochar-applications";
import {
  buildVersionedMeasurementSampleSubmissions,
  normalizeMeasurementSamplesForHash,
  type DurabilityMeasurementSampleClaimArgs,
} from "./durability-measurement-sample-snapshot";
import {
  assertRemovalDatesNotFuture,
  assertReportingWindowNotInverted,
  resolveLatestApplicationTime,
  resolveRemovalReportingWindow,
} from "./removal-reporting-window";
import type { ResolvedFixedInput } from "./removal-snapshot-readers";
import {
  compileBiocharApplicationIntents,
  type BiocharApplicationIntent,
} from "./biochar-application-intents";
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
import {
  resolveTemplateInputs,
  type ResolvedMonitoredInput,
} from "./removal-template-inputs";
import {
  includesProductionInputs,
  productionClaimContribution,
} from "./production-claim-policy";

export interface RemovalSubmissionBuild {
  agg: AggregatedProductionData;
  reportingWindow: { startedOn: Date; completedOn: Date };
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
  biocharApplicationIntents: BiocharApplicationIntent[];
  omittedTemplateComponentIds: string[];
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
  applications: Array<{
    id: string;
    code: string;
    deliveryId: string;
    deliveryCode: string;
  }>;
  reportingWindow: { startedOn: string; completedOn: string };
  productionEmissionClaims?: Array<{
    creditBatchId: string;
    creditBatchCode: string;
    claimingRemovalId: string | null;
    contribution: "production-and-delivery" | "delivery-only";
  }>;
}

export function buildProductionEmissionClaims(
  memberBatchClaims: RemovalSubmissionContext["memberBatchClaims"],
  removalId: string,
): NonNullable<RemovalSubmissionReview["productionEmissionClaims"]> {
  return memberBatchClaims.map((batch) => ({
    creditBatchId: batch.creditBatchId,
    creditBatchCode: batch.code,
    claimingRemovalId: batch.claimedByRemovalId,
    contribution: productionClaimContribution(
      batch.claimedByRemovalId,
      removalId,
    ),
  }));
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
      omittedTemplateComponentIds: string[];
      biocharApplicationIntents: BiocharApplicationIntent[];
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
  metadata: { supersedePreviousId: string | null };
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
    applications: [],
    reportingWindow: { startedOn: "", completedOn: "" },
    productionEmissionClaims: [],
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
      ? new Set(
          build.sourceBindingPlan.map((entry) => entry.documentId),
        ).size
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
    applications: [
      ...new Map(
        args.ctx.lineages.map((lineage) => [
          lineage.application.id,
          {
            id: lineage.application.id,
            code: lineage.application.code,
            deliveryId: lineage.delivery.id,
            deliveryCode: lineage.delivery.code,
          },
        ]),
      ).values(),
    ],
    reportingWindow: {
      startedOn: build.reportingWindow.startedOn.toISOString(),
      completedOn: build.reportingWindow.completedOn.toISOString(),
    },
    productionEmissionClaims: buildProductionEmissionClaims(
      args.ctx.memberBatchClaims,
      args.removalId,
    ),
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
  supersedePreviousId: string | null;
}): MaterializedRemovalSubmissionSnapshot {
  const {
    compiled,
    template,
    externalProjectId,
    removalId,
    nextVersion,
    supersedePreviousId,
  } = args;
  const removalSupplierRef = buildRemovalSupplierRef({
    removalId,
    role: "removal",
    version: nextVersion,
  });
  const biocharApplicationIntents = compiled.biocharApplicationIntents.map(
    (intent) => ({
      ...intent,
      supplierReference: buildBiocharApplicationReference({
        applicationId: intent.applicationId,
        creditBatchId: intent.creditBatchId,
        environment: env.ISOMETRIC_ENVIRONMENT,
        removalSubmissionVersion: nextVersion,
      }),
    }),
  );
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
      }).map((datapoint) => ({
        ...datapoint,
        body: {
          ...datapoint.body,
          source_ids: sourceIdsForDatapointTarget(
            compiled.sourceBindingPlan,
            {
              componentId: datapoint.rtcId,
              inputKey: datapoint.inputKey,
            },
          ),
        },
      }))
    : [];

  return {
    payloadSnapshot: {
      __mappingRevision: MAPPING_REVISION,
      semantic: compiled.semanticPayload,
      memberCreditBatchIds: compiled.memberCreditBatchIds,
      sourceBindingPlan: compiled.sourceBindingPlan,
      transport: {
        removalSupplierRef,
        omittedTemplateComponentIds:
          compiled.omittedTemplateComponentIds,
        biocharApplicationIntents,
        datapointBodies: [
          ...finalDatapointBodies,
          ...directSequestrationDatapoints,
        ],
      },
      ...(durabilityMeasurementSamples
        ? { durabilityMeasurementSamples }
        : {}),
    },
    metadata: { supersedePreviousId },
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

  const biocharApplicationIntents = await compileBiocharApplicationIntents({
    orgCtx,
    memberBatches: ctx.memberBatchClaims,
    environment: env.ISOMETRIC_ENVIRONMENT,
  });

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
    ...aggregateProductionRuns(ctx.runs, ctx.attributionByRunId, {
      productionRunIds: new Set(
        ctx.memberBatchClaims
          .filter((batch) =>
            includesProductionInputs(batch.claimedByRemovalId, removalId),
          )
          .flatMap((batch) => batch.productionRunIds),
      ),
    }),
    ...weightedBatchChemistry(ctx.batchesWithSamples, ctx.attributionByRunId),
  };
  const hasProductionContribution = ctx.memberBatchClaims.some((batch) =>
    includesProductionInputs(batch.claimedByRemovalId, removalId),
  );
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
  const reportingWindow = resolveRemovalReportingWindow({
    earliestProductionStartTime: agg.earliestStartTime,
    latestProductionEndTime: agg.latestEndTime,
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
          removalId,
          lineages: ctx.lineages,
          memberBatches: ctx.memberBatches,
          memberSamples: ctx.batchesWithSamples.flatMap((batch) =>
            batch.samples.map((sample) => ({
              id: sample.id,
              code: sample.sampleCode,
            })),
          ),
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
    Array.from(
      new Set(candidateSourceDocuments.map((candidate) => candidate.documentId)),
    ).sort();
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
  // Delivery bills of lading target batch-scoped transport inputs.
  const deliveryIdByApplicationId = new Map(
    ctx.lineages.map((lineage) => [
      lineage.application.id,
      lineage.delivery.id,
    ]),
  );
  const deliveryIdsByCreditBatchId = new Map(
    ctx.memberBatchClaims.map((batch) => [
      batch.creditBatchId,
      Array.from(
        new Set(
          batch.applicationIds.flatMap((applicationId) => {
            const deliveryId = deliveryIdByApplicationId.get(applicationId);
            return deliveryId ? [deliveryId] : [];
          }),
        ),
      ),
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
    sampleIdsByCreditBatchId: new Map(
      ctx.batchesWithSamples.map((batch) => [
        batch.creditBatchId,
        batch.samples.map((sample) => sample.id),
      ]),
    ),
    deliveryIdsByCreditBatchId,
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
    sampleIdsByCreditBatchId: new Map(
      ctx.batchesWithSamples.map((batch) => [
        batch.creditBatchId,
        batch.samples.map((sample) => sample.id),
      ]),
    ),
    deliveryIdsByCreditBatchId,
  });

  const {
    monitored,
    fixed,
    datapointBodyByKey,
    omittedTemplateComponentIds,
  } = resolveTemplateInputs({
    template: defaultTemplate,
    blueprintsByKey,
    agg,
    externalProjectId,
    sourceIds,
    sourceBindingPlan,
    allowPeriodInputStub,
    omitProductionComponents: !hasProductionContribution,
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
    omittedTemplateComponentIds,
    sequestrationTemplate: normalizeSequestrationTemplateForHash(
      defaultTemplate,
    ),
    sourceProductionRunIds: [...agg.sourceProductionRunIds].sort(),
    startedOn: reportingWindow.startedOn.toISOString(),
    completedOn: reportingWindow.completedOn.toISOString(),
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
    biocharApplicationIntents,
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
    reportingWindow,
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
    biocharApplicationIntents,
    omittedTemplateComponentIds,
  };
}
