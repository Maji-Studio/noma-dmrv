import { normalizeTemplateDefinition, resolveLineSources, type GhgEntryTemplate, type LineSources } from "@/lib/isometric/template-observations";
import { acceptAllProposals } from "@/lib/isometric/template-observations/test-support";

/** Test setup only. Ambiguous/unassigned shapes still need explicit assignments. */
export function reviewedTemplateSources(template: GhgEntryTemplate, overrides: LineSources = {}): LineSources {
  // Empty components are scaffolding in preparation-only tests, with no data to bind.
  const emptyLines: LineSources = Object.fromEntries(template.groups.flatMap((group) => group.components
    .filter((component) => component.inputs.every((input) => input.type === "fixed"))
    .map((component) => [component.id, { scope: "operating", entryPolicy: "none", origin: "reviewed" }])));
  return { ...acceptAllProposals(resolveLineSources({ definition: normalizeTemplateDefinition(template) })), ...emptyLines, ...overrides };
}
