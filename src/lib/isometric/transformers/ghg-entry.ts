import { SafeError } from "@/lib/errors";
import type { components } from "../generated/certify";
import { isSequestrationBlueprintKey } from "./measurement-sample";

type CreateGhgEntryRequest = components["schemas"]["CreateGhgEntryRequest"];
type GhgEntryTemplate = components["schemas"]["GhgEntryTemplate"];
type GhgEntryTemplateComponentInputs =
  components["schemas"]["GhgEntryTemplateComponentInputs"];
type ComponentBlueprint = components["schemas"]["ComponentBlueprint"];
type CreateComponentScalarInput =
  components["schemas"]["CreateComponentScalarInput"];
type CreateComponentListInput =
  components["schemas"]["CreateComponentListInput"];

export interface BuildCreateGhgEntryArgs {
  template: GhgEntryTemplate;
  blueprintsByKey: Map<string, ComponentBlueprint>;
  // Resolved scalar datapoint IDs keyed by `${rtcId}::${inputKey}` — orchestrator
  // populates one entry per monitored input plus pre-bound fixed inputs.
  datapointIdsByRtcInput: Map<string, string>;
  // The removal's reporting window (Biochar Protocol §8.6.2; local
  // interpretation pin v1.2): starts with production, ends when the biochar is
  // applied at the storage site — NOT the production window. The orchestrator
  // derives `completedOn` from the latest application date across the removal's
  // lineages (issue #320).
  reportingWindow: { startedOn: Date; completedOn: Date };
  projectId: string;
  supplierRefId: string;
}

export function buildCreateGhgEntryRequest(
  args: BuildCreateGhgEntryArgs,
): CreateGhgEntryRequest {
  const {
    template,
    blueprintsByKey,
    datapointIdsByRtcInput,
    reportingWindow,
    projectId,
    supplierRefId,
  } = args;

  const rtComponents: GhgEntryTemplateComponentInputs[] = [];

  for (const group of template.groups) {
    for (const component of group.components) {
      // The `biochar_sequestration_200_year_*` components are fed by the
      // measurement-samples step (Phase 3), not the datapoint loop, so they carry
      // no resolved datapoint here — skip them in the removal body. The registry
      // binds their inputs to the measurement-sample datapoints (binding mode is
      // sandbox-gated; see docs/open-questions.md). resolveTemplateInputs skips
      // them to match.
      if (isSequestrationBlueprintKey(component.blueprint_key)) continue;
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
        } else if (blueprintInput.data_shape === "SCALAR") {
          inputs.push({
            __typename: "CreateComponentScalarInput",
            datapoint_id: datapointId,
            input_key: rtcInput.input_key,
          });
        } else {
          throw new SafeError(
            `Blueprint "${component.blueprint_key}" input "${rtcInput.input_key}" has unsupported data_shape "${blueprintInput.data_shape}".`,
          );
        }
      }

      rtComponents.push({
        ghg_entry_template_component_id: component.id,
        inputs,
      });
    }
  }

  return {
    // §8.6.2: the Reporting Period "ends upon application of biochar from that
    // batch at the storage site" — completed_on carries the latest application
    // date, not production end (issue #320).
    completed_on: toISODate(reportingWindow.completedOn),
    project_id: projectId,
    started_on: toISODate(reportingWindow.startedOn),
    supplier_reference_id: supplierRefId,
    ghg_entry_template_id: template.id,
    ghg_entry_template_components: rtComponents,
  };
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
