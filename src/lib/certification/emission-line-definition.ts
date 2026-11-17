import type { TemplateDefinition } from "@/lib/isometric/template-observations/types";

/** Retain removed components for entry review only. Never use this definition to compile. */
export function withRemovedEntryComponents(
  current: TemplateDefinition,
  entries: readonly { componentId: string; observationId: string }[],
  previousObservations: ReadonlyMap<string, { definition: TemplateDefinition } | null>,
): TemplateDefinition {
  const definition = structuredClone(current);
  const present = new Set(
    definition.groups.flatMap((group) => group.components.map((component) => component.id)),
  );
  for (const entry of entries) {
    if (present.has(entry.componentId)) continue;
    const previous = previousObservations.get(entry.observationId);
    const group = previous?.definition.groups.find((group) =>
      group.components.some((component) => component.id === entry.componentId),
    );
    const component = group?.components.find((component) => component.id === entry.componentId);
    if (group && component) {
      definition.groups.push({ ...group, components: [component] });
      present.add(component.id);
    }
  }
  return definition;
}

/** Resolve names from the same per-batch definitions used to project entry lines. */
export function removalEntryComponentDisplayName(batches: Readonly<Record<string, {
  definition: TemplateDefinition;
  entries: Parameters<typeof withRemovedEntryComponents>[1];
  previousObservations?: Parameters<typeof withRemovedEntryComponents>[2];
}>>): (componentId: string, batchId: string) => string | undefined {
  const names = new Map(Object.entries(batches).map(([batchId, facts]) => [batchId, new Map(
    withRemovedEntryComponents(facts.definition, facts.entries, facts.previousObservations ?? new Map())
      .groups.flatMap((group) => group.components.map((component) => [component.id, component.displayName] as const)),
  )]));
  return (componentId, batchId) => names.get(batchId)?.get(componentId);
}
