import { removalLineBlockerMessage } from "@/lib/certification/removal-blockers";
import { deriveBatchEmissionLines, type BatchEmissionLine } from "@/lib/certification/emission-lines";
import { normalizeTemplateDefinition } from "@/lib/isometric/template-observations/normalize";
import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { type LineSources } from "@/lib/isometric/template-observations/line-sources";
import { ownValue } from "@/lib/isometric/semantic-binding-catalog";
import { pluralize } from "@/lib/copy-utils";
import { SafeError } from "@/lib/errors";
import type {
  AggregatedProductionData,
  CreateDatapointRequest,
  IsometricComponentBlueprint,
  IsometricGhgEntryTemplate,
} from "@/lib/isometric";
import {
  buildCreateDatapointRequest,
  lookupInputMapping,
} from "@/lib/isometric/transformers/datapoint";
import { isSequestrationBlueprintFamily } from "@/lib/isometric/storage-blueprints";
import {
  sourceIdsForDatapointTarget,
  type RemovalSourceBindingPlanEntry,
} from "@/lib/certification/removal-source-bindings";
import type { ResolvedFixedInput } from "./removal-snapshot-readers";

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
  omittedTemplateComponentIds: string[];
}

export function resolveTemplateInputs(args: {
  template: IsometricGhgEntryTemplate;
  lineSources: LineSources;
  enrichmentComplete?: boolean;
  emissionLines?: BatchEmissionLine[] | null;
  blueprintsByKey: Map<string, IsometricComponentBlueprint>;
  agg: AggregatedProductionData;
  externalProjectId: string;
  sourceIds: string[];
  sourceBindingPlan: RemovalSourceBindingPlanEntry[];
  allowPeriodInputStub: boolean;
  omitProductionComponents: boolean;
}): ResolvedTemplateInputs {
  const {
    template,
    lineSources,
    blueprintsByKey,
    agg,
    externalProjectId,
    sourceIds,
    sourceBindingPlan,
    allowPeriodInputStub,
    omitProductionComponents,
  } = args;

  // Keep compilation capability guards until PR 4 supplies entry contributions.
  const lineDecisions = [...(args.emissionLines ?? []), ...deriveBatchEmissionLines({
    definition: normalizeTemplateDefinition(template), lineSources, problems: [],
    enrichmentComplete: args.enrichmentComplete ?? true, automaticFigures: {}, entries: [],
  })];

  const monitored: ResolvedMonitoredInput[] = [];
  const fixed: ResolvedFixedInput[] = [];
  const datapointBodyByKey = new Map<string, CreateDatapointRequest>();
  const omittedTemplateComponentIds: string[] = [];
  const unboundFixedInputs: { component: string; inputKey: string }[] = [];

  for (const group of template.groups) {
    for (const component of group.components) {
      const lineContract = ownValue(lineSources, component.id);
      const blocker = lineDecisions.find((line) => line.componentId === component.id && line.blocker)?.blocker;
      if (blocker) throw new SafeError(removalLineBlockerMessage(blocker));
      const monitoredMappings = component.inputs
        .filter((input) => input.type === "monitored")
        .map((input) =>
          lookupInputMapping(
            group.key,
            component.blueprint_key,
            input.input_key,
            lineContract,
          ),
        )
        .filter((mapping) => mapping != null);
      if (
        omitProductionComponents &&
        monitoredMappings.length > 0 &&
        monitoredMappings.every((mapping) => mapping.bucket === "production")
      ) {
        omittedTemplateComponentIds.push(component.id);
        continue;
      }
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
          (input) => input.input_key === rtcInput.input_key,
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
          lineContract,
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
      `Removal template "${template.display_name}" has ${unboundFixedInputs.length} fixed ${pluralize(unboundFixedInputs.length, "value")} missing in ${components}. ${REMOVAL_TEMPLATE_BLOCKERS.missingFixedDatapoint}`,
    );
  }

  return {
    monitored,
    fixed,
    datapointBodyByKey,
    omittedTemplateComponentIds,
  };
}
