import type { GhgEntryTemplate, TemplateDefinition } from "./types";

/** Code-point order is stable across server locales. Never mutate the REST input. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normalizeTemplateDefinition(template: GhgEntryTemplate): TemplateDefinition {
  return {
    groups: template.groups.map((group) => ({
      id: group.id,
      key: group.key,
      displayName: group.display_name,
      description: group.description,
      components: group.components.map((component) => ({
        id: component.id,
        displayName: component.display_name,
        description: component.description,
        blueprintKey: component.blueprint_key,
        inputs: component.inputs.map((input) => ({
          key: input.input_key,
          type: input.type,
          quantityKind: input.quantity_kind,
          ...(input.type === "fixed" && input.datapoint_id != null
            ? { fixedDatapointId: input.datapoint_id } : {}),
        })).sort((a, b) => compareIds(a.key, b.key)),
      })).sort((a, b) => compareIds(a.id, b.id)),
    })).sort((a, b) => compareIds(a.id, b.id)),
  };
}
