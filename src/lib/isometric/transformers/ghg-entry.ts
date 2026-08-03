import { SafeError } from "@/lib/errors";
import { formatCount } from "@/lib/copy-utils";
import type { components } from "../generated/certify";
import { isSequestrationBlueprintFamily } from "./measurement-sample";
import {
  getSequestrationInputBinding,
  hasExplicitSequestrationBinding,
  type DatapointIdsByRtcInput,
} from "./sequestration-binding";

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
  // Resolved datapoint IDs keyed by `${rtcId}::${inputKey}`. Ordinary scalar
  // inputs carry one ID; measurement-sample-backed sequestration LIST inputs
  // carry every returned replicate ID.
  datapointIdsByRtcInput: DatapointIdsByRtcInput;
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
      const isSequestration = isSequestrationBlueprintFamily(
        component.blueprint_key,
      );
      if (
        isSequestration &&
        !hasExplicitSequestrationBinding(component.blueprint_key)
      ) {
        throw new SafeError(
          "The selected Removal template contains an unsupported component. Choose another template before submitting.",
        );
      }

      const blueprint = isSequestration
        ? null
        : blueprintsByKey.get(component.blueprint_key);
      if (!isSequestration && !blueprint) {
        throw new SafeError(
          "A component in the selected Removal template is no longer available. Ask an Admin to check the template before submitting.",
        );
      }

      const inputs: (CreateComponentScalarInput | CreateComponentListInput)[] =
        [];
      for (const rtcInput of component.inputs) {
        const sequestrationBinding = isSequestration
          ? getSequestrationInputBinding(
              component.blueprint_key,
              rtcInput.input_key,
            )
          : null;
        const blueprintInput = blueprint?.inputs.find(
          (input) => input.input_key === rtcInput.input_key,
        );
        if (isSequestration && !sequestrationBinding) {
          throw new SafeError(
            "The selected Removal template contains an unsupported field. Ask support to update the registry mapping before submitting.",
          );
        }
        if (!isSequestration && !blueprintInput) {
          throw new SafeError(
            "The selected Removal template is missing a required field. Ask an Admin to update the template.",
          );
        }
        const datapointIds = datapointIdsByRtcInput.get(
          `${component.id}::${rtcInput.input_key}`,
        );
        if (!datapointIds || datapointIds.length === 0) {
          throw new SafeError(
            "A registry component has no submitted value. Check the Removal data before submitting.",
          );
        }

        const dataShape =
          sequestrationBinding?.dataShape ?? blueprintInput?.data_shape;
        if (dataShape === "LIST") {
          inputs.push({
            __typename: "CreateComponentListInput",
            datapoint_ids: datapointIds,
            input_key: rtcInput.input_key,
          });
        } else if (dataShape === "SCALAR") {
          if (datapointIds.length !== 1) {
            throw new SafeError(
              `A registry field has ${formatCount(datapointIds.length, "value")} but accepts one. Ask support to check the Removal template.`,
            );
          }
          inputs.push({
            __typename: "CreateComponentScalarInput",
            datapoint_id: datapointIds[0],
            input_key: rtcInput.input_key,
          });
        } else {
          throw new SafeError(
            "The selected Removal template contains a field with an unsupported format. Ask support to check the template.",
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
