import type { OrgContext } from "@/lib/auth/server";
import { appliedBiocharFraction } from "@/lib/certification/mass-accounting";
import { SafeError } from "@/lib/errors";
import {
  aggregateProductionRuns,
  enrichWithTransportLegs,
  type AggregatedProductionData,
  type CreateDatapointRequest,
  type IsometricComponentBlueprint,
  type IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import { buildCreateDatapointRequest } from "@/lib/isometric/transformers/datapoint";
import { isSequestrationBlueprintFamily } from "@/lib/isometric/transformers/measurement-sample";
import { weightedBatchChemistry } from "@/lib/isometric/utils/durability-aggregation";
import type { Logger } from "@/lib/log";
import {
  buildVersionedMeasurementSampleSubmissions,
  normalizeMeasurementSamplesForHash,
  type DurabilityMeasurementSampleClaimArgs,
} from "./durability-measurement-sample-snapshot";
import {
  assertReportingWindowNotInverted,
  resolveLatestApplicationTime,
} from "./removal-reporting-window";
import type { ResolvedFixedInput } from "./removal-snapshot-readers";
import {
  collectCandidateDocumentIdsForRemoval,
  resolveSourceIdsForRemoval,
} from "./sources";
import type { RemovalSubmissionContext } from "./certify-context-core";

export interface ResolvedMonitoredInput {
  removalTemplateComponentId: string;
  componentBlueprintKey: string;
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
  sourceIds: string[];
  semanticPayload: Record<string, unknown>;
  monitored: ResolvedMonitoredInput[];
  fixed: ResolvedFixedInput[];
  datapointBodyByKey: Map<string, CreateDatapointRequest>;
  durabilityMeasurementSampleArgs: DurabilityMeasurementSampleClaimArgs | null;
  memberCreditBatchIds: string[];
}

export function assertEntityReadinessGapsResolved(
  entityReadinessGaps: string[] | undefined,
): void {
  if (!entityReadinessGaps) {
    throw new SafeError(
      "Removal submission blocked - entity certification readiness was not evaluated.",
    );
  }
  if (entityReadinessGaps.length === 0) return;

  throw new SafeError(
    `Removal submission blocked - entity certification readiness:\n${entityReadinessGaps.join("\n")}`,
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
      `Removal submission blocked - sampling & eligibility:\n${ctx.durabilityGateBlockers.join("\n")}`,
    );
  }

  const transportAgg = enrichWithTransportLegs(baseAgg, ctx.transportLegs, {
    appliedBiocharFraction: appliedBiocharFraction(ctx.runSummary),
  });
  const transportWarnings = transportAgg.warnings.slice(baseAgg.warnings.length);
  if (transportWarnings.length > 0) {
    throw new SafeError(
      `Removal transport-leg aggregation - submission blocked:\n${transportWarnings.join("\n")}`,
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

  if (ctx.submissionWarnings.length > 0) {
    log?.warn(
      { submissionWarnings: ctx.submissionWarnings },
      "removal has non-blocking submission warnings",
    );
  }

  // A caller-supplied Source set makes this a side-effect-free preflight or a
  // locked rebuild. Skip the document walk in that case; the caller already
  // owns the authoritative IDs and does not consume `candidateDocumentIds`.
  const candidateDocumentIds = args.sourceIds
    ? []
    : await collectCandidateDocumentIdsForRemoval(orgCtx, {
        lineages: ctx.lineages,
        memberBatchIds: ctx.memberBatches.map((b) => b.id),
      });
  const sourceIds =
    args.sourceIds ??
    (await resolveSourceIdsForRemoval(orgCtx, { candidateDocumentIds }));

  const { monitored, fixed, datapointBodyByKey } = resolveTemplateInputs({
    template: defaultTemplate,
    blueprintsByKey,
    agg,
    externalProjectId,
    sourceIds,
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
          version: 0,
        }),
      )
    : [];

  const semanticPayload = {
    removalId,
    templateId: defaultTemplate.id,
    sourceProductionRunIds: [...agg.sourceProductionRunIds].sort(),
    startedOn: agg.earliestStartTime.toISOString(),
    completedOn: latestApplicationTime.toISOString(),
    sourceIds,
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
    sourceIds,
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
  allowPeriodInputStub: boolean;
}): ResolvedTemplateInputs {
  const {
    template,
    blueprintsByKey,
    agg,
    externalProjectId,
    sourceIds,
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
      // buildCreateGhgEntryRequest skips it in the removal body to match. The
      // submit-time template↔tier guard fails closed on a sequestration
      // component outside the facility tier's expected set.
      if (isSequestrationBlueprintFamily(component.blueprint_key)) continue;
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
        const draft = buildCreateDatapointRequest({
          groupKey: group.key,
          componentBlueprintKey: component.blueprint_key,
          componentDisplayName: component.display_name,
          rtcInput,
          blueprintInput,
          agg,
          projectId: externalProjectId,
          supplierRefId: "__placeholder__",
          sourceIds,
          allowPeriodInputStub,
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
      .map((u) => `  - ${u.component} -> ${u.inputKey}`)
      .join("\n");
    throw new SafeError(
      `Template "${template.display_name}" has ${unboundFixedInputs.length} fixed input(s) without a pre-bound datapoint:\n${lines}\nBind each as a constant in the Isometric template editor before submitting.`,
    );
  }

  return { monitored, fixed, datapointBodyByKey };
}
