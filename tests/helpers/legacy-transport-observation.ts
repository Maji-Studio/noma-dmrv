import production from "../fixtures/isometric/production-template-2026-07-03.json";
import { normalizeTemplateDefinition, type GhgEntryTemplate, type LineSources } from "@/lib/isometric/template-observations";

/** Stored admin decision from before paired transport entry policies tightened. */
export function legacyTransportObservation() {
  const componentId = "rtc_1KWKNGJZY1S0D548";
  const template = structuredClone(production) as GhgEntryTemplate;
  template.groups = template.groups.flatMap(group => {
    const components = group.components.filter(component => component.id === componentId)
      .map(component => ({ ...component, inputs: component.inputs.filter(input => input.type === "monitored") }));
    return components.length ? [{ ...group, components }] : [];
  });
  const definition = normalizeTemplateDefinition(template);
  const lineSources: LineSources = { [componentId]: {
    scope: "operating", entryPolicy: "additive", automaticSource: "feedstock-transport", origin: "reviewed",
  } };
  const enrichment = { [componentId]: Object.fromEntries(definition.groups[0].components[0].inputs
    .map(input => [input.key, { unit: input.quantityKind === "mass" ? "kg" : "km" }])) };
  return { template, componentId, observation: { id: "legacy-observation", externalTemplateId: template.id, definition, lineSources, enrichment } };
}
