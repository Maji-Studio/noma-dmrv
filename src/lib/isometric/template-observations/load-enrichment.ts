import { getSequestrationInputBinding } from "../sequestration-input-bindings";
import { CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR } from "../storage-blueprints";
import { canonicalUnit } from "./units";
import type { IsometricClient } from "../client";
import type { IsometricComponentBlueprint } from "../projects";
import { getDatapoint } from "../submissions";
import { normalizeTemplateDefinition } from "./normalize";
import type { GhgEntryTemplate, InputEnrichment, TemplateEnrichment } from "./types";

/** REST has no deprecation field. Failed reads are local, retryable unknowns. */
export async function loadTemplateEnrichment(
  client: IsometricClient,
  template: GhgEntryTemplate,
  blueprints: IsometricComponentBlueprint[],
): Promise<TemplateEnrichment> {
  const definition = normalizeTemplateDefinition(template);
  const ids = [...new Set(definition.groups.flatMap((group) => group.components.flatMap((component) =>
    component.inputs.flatMap((input) => input.type === "fixed" && input.fixedDatapointId ? [input.fixedDatapointId] : []),
  )))];
  const datapoints = new Map(await Promise.all(ids.map(async (id) => {
    let enrichment: InputEnrichment = { status: "unknown" };
    try {
      const datapoint = await getDatapoint(client, id);
      if (datapoint.quantity.unit) enrichment = {
        unit: datapoint.quantity.unit, fixedValue: datapoint.quantity.magnitude, deprecated: null,
      };
    } catch { /* A failed GET blocks this input without losing the other reads. */ }
    return [id, enrichment] as const;
  })));
  const blueprintByKey = new Map(blueprints.map((blueprint) => [blueprint.key, blueprint]));
  return Object.fromEntries(definition.groups.flatMap((group) => group.components.map((component) => [
    component.id,
    Object.fromEntries(component.inputs.map((input): [string, InputEnrichment] => {
      if (input.type === "fixed") return [input.key, datapoints.get(input.fixedDatapointId ?? "") ?? { status: "unknown" }];
      const blueprint = blueprintByKey.get(component.blueprintKey);
      let unit = blueprint?.inputs.find((candidate) => candidate.input_key === input.key)?.compatible_unit;
      // This supported blueprint is sometimes absent from the registry catalog.
      // Fall back only to its exact validated input contracts, never to guessed units.
      if (!blueprint && component.blueprintKey === CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR) {
        const binding = getSequestrationInputBinding(component.blueprintKey, input.key);
        const quantityKind = binding?.source === "measurement-property" ? binding.measurementProperty.quantity_kind : binding?.quantityKind;
        if (binding && quantityKind === input.quantityKind && canonicalUnit(input.quantityKind, binding.sourceContract.wireUnit)) {
          unit = binding.sourceContract.wireUnit;
        }
      }
      return [input.key, unit ? { unit, deprecated: null } : { status: "unknown" }];
    })),
  ])));
}
