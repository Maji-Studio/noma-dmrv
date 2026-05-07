import { SafeError } from "@/lib/errors";
import type { components } from "../generated/certify";
import type { AggregatedProductionData } from "../utils/aggregation";

type CreateRemovalRequest = components["schemas"]["CreateRemovalRequest"];
type RemovalTemplate = components["schemas"]["RemovalTemplate"];
type RemovalTemplateComponentInputs =
  components["schemas"]["RemovalTemplateComponentInputs"];
type ComponentBlueprint = components["schemas"]["ComponentBlueprint"];
type CreateComponentScalarInput =
  components["schemas"]["CreateComponentScalarInput"];
type CreateComponentListInput =
  components["schemas"]["CreateComponentListInput"];

export interface BuildCreateRemovalArgs {
  template: RemovalTemplate;
  blueprintsByKey: Map<string, ComponentBlueprint>;
  // Resolved scalar datapoint IDs keyed by `${rtcId}::${inputKey}` — orchestrator
  // populates one entry per monitored input plus pre-bound fixed inputs.
  datapointIdsByRtcInput: Map<string, string>;
  agg: AggregatedProductionData;
  projectId: string;
  supplierRefId: string;
}

export function buildCreateRemovalRequest(
  args: BuildCreateRemovalArgs,
): CreateRemovalRequest {
  const {
    template,
    blueprintsByKey,
    datapointIdsByRtcInput,
    agg,
    projectId,
    supplierRefId,
  } = args;

  const rtComponents: RemovalTemplateComponentInputs[] = [];

  for (const group of template.groups) {
    for (const component of group.components) {
      const blueprint = blueprintsByKey.get(component.blueprint_key);
      if (!blueprint) {
        throw new SafeError(
          `Component blueprint "${component.blueprint_key}" missing from catalog — drift detected.`,
        );
      }

      const inputs: (CreateComponentScalarInput | CreateComponentListInput)[] =
        [];
      for (const rtcInput of component.inputs) {
        const blueprintInput = blueprint.inputs.find(
          (i) => i.input_key === rtcInput.input_key,
        );
        if (!blueprintInput) {
          throw new SafeError(
            `Blueprint "${component.blueprint_key}" missing input "${rtcInput.input_key}".`,
          );
        }
        const datapointId = datapointIdsByRtcInput.get(
          `${component.id}::${rtcInput.input_key}`,
        );
        if (!datapointId) {
          throw new SafeError(
            `Orchestrator did not resolve a datapoint for component ${component.id} input "${rtcInput.input_key}".`,
          );
        }

        if (blueprintInput.data_shape === "LIST") {
          inputs.push({
            __typename: "CreateComponentListInput",
            datapoint_ids: [datapointId],
            input_key: rtcInput.input_key,
          });
        } else {
          inputs.push({
            __typename: "CreateComponentScalarInput",
            datapoint_id: datapointId,
            input_key: rtcInput.input_key,
          });
        }
      }

      rtComponents.push({
        removal_template_component_id: component.id,
        inputs,
      });
    }
  }

  return {
    completed_on: toISODate(agg.latestEndTime),
    project_id: projectId,
    started_on: toISODate(agg.earliestStartTime),
    supplier_reference_id: supplierRefId,
    removal_template_id: template.id,
    removal_template_components: rtComponents,
  };
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
