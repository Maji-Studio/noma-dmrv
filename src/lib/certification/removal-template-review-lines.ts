import type { IsometricComponentBlueprint, IsometricGhgEntryTemplate } from "@/lib/isometric";
import { allowedEntryPolicies } from "@/lib/isometric/template-observations/entry-policies";
import { catalogCandidates } from "@/lib/isometric/template-observations/catalog-sources";
import type { ComponentChange } from "@/lib/isometric/template-observations/compare";
import type { LineSources } from "@/lib/isometric/template-observations/line-sources";
import type { TemplateDefinition } from "@/lib/isometric/template-observations/types";
import { templateLineSection } from "@/lib/isometric/template-observations/template-sections";

export function removalTemplateReviewLines(
  definition: TemplateDefinition, lineSources: LineSources, changes: Record<string, ComponentChange>,
  blueprints: readonly IsometricComponentBlueprint[], template?: IsometricGhgEntryTemplate,
) {
  const positions = new Map(template?.groups.map((group, position) => [group.key, position]));
  const blueprintTypes = new Map(blueprints.map((blueprint) => [blueprint.key, blueprint.type]));
  return definition.groups.flatMap((group, normalizedPosition) => group.components.map((component) => {
    const blueprintType = blueprintTypes.get(component.blueprintKey) ?? null;
    return {
      component, groupKey: group.key, groupName: group.displayName, blueprintType,
      groupPosition: positions.get(group.key) ?? lineSources[component.id]?.templateOrder?.groupPosition ?? normalizedPosition,
      section: templateLineSection(blueprintType, component.blueprintKey),
      contract: lineSources[component.id] ?? { scope: "unassigned" as const, entryPolicy: "none" as const, origin: "proposed" as const },
      catalogCandidates: catalogCandidates(component, group.key), allowedEntryPolicies: allowedEntryPolicies(component),
      change: changes[component.id] ?? ("added" as ComponentChange),
    };
  }));
}
