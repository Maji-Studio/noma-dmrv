import type { RemovalTemplateObservation } from "@/db/schema/removal-template-observations";
import type { IsometricComponentBlueprint, IsometricGhgEntryTemplate } from "@/lib/isometric";
import { enrichmentProblems, validateLineSources } from "@/lib/isometric/template-observations";
import { deriveRequiredTransportCategories } from "./certify-transport-coverage";
import type { RemovalTemplateFacts } from "./removal-template-facts";

/** DB-only compiler adapter. Never use this to authorize an outbound submission:
 * submission still freshly lists the registry template and reads its blueprints.
 * The scalar compiler consumes only the observed input kind and compatible unit.
 * Sequestration replicate shapes are supplied by the existing explicit bindings.
 */
export function storedRemovalTemplateFacts(observation: RemovalTemplateObservation): RemovalTemplateFacts {
  const template: IsometricGhgEntryTemplate = {
    id: observation.externalTemplateId, project_id: observation.externalProjectId,
    credit_type: "REMOVAL", display_name: observation.externalTemplateId, supplier_reference_id: null,
    groups: observation.definition.groups.map(group => ({
      id: group.id, key: group.key, display_name: group.displayName, description: group.description,
      components: group.components.map(component => ({
        id: component.id, blueprint_key: component.blueprintKey,
        display_name: component.displayName, description: component.description,
        ghg_entry_template_id: observation.externalTemplateId,
        ghg_entry_template_component_group_id: group.id,
        inputs: component.inputs.map(input => ({
          input_key: input.key, display_name: input.key, type: input.type,
          quantity_kind: input.quantityKind, datapoint_id: input.fixedDatapointId ?? null,
        })),
      })),
    })),
  };
  const blueprints = new Map<string, IsometricComponentBlueprint>();
  for (const component of observation.definition.groups.flatMap(group => group.components)) {
    const blueprint = blueprints.get(component.blueprintKey) ?? {
      key: component.blueprintKey, display_name: component.displayName, description: "",
      expressions: [], type: "ACTIVITY", inputs: [],
    };
    for (const input of component.inputs) {
      if (blueprint.inputs.some(existing => existing.input_key === input.key)) continue;
      const enrichment = observation.enrichment[component.id]?.[input.key];
      blueprint.inputs.push({ input_key: input.key, quantity_kind: input.quantityKind,
        compatible_unit: enrichment && "unit" in enrichment ? enrichment.unit : "",
        data_shape: "SCALAR", description: "" });
    }
    blueprints.set(component.blueprintKey, blueprint);
  }
  return {
    template, observation, blueprintsForTemplate: [...blueprints.values()], unresolvedBlueprintKeys: [],
    enrichmentProblems: enrichmentProblems(observation.definition, observation.enrichment),
    lineSourceProblems: validateLineSources(observation.definition, observation.lineSources),
    unbindableTemplateInputs: [], requiredTransportCategories: deriveRequiredTransportCategories(template),
  };
}
