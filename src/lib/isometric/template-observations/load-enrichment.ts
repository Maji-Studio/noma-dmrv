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
      const unit = blueprintByKey.get(component.blueprintKey)?.inputs.find((candidate) => candidate.input_key === input.key)?.compatible_unit;
      return [input.key, unit ? { unit, deprecated: null } : { status: "unknown" }];
    })),
  ])));
}
