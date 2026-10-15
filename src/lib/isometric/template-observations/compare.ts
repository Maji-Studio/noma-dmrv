import { canonicalJson } from "@/lib/canonical-json";
import { ownValue } from "../semantic-binding-catalog";
import { fingerprintComponent } from "./fingerprints";
import { compareIds } from "./normalize";
import { unitsConvertible } from "./units";
import type { EntryLine, TemplateObservation } from "./types";

export type ComponentChange = "unchanged" | "cosmetic" | "changed" | "removed" | "added";

function lines(observation: TemplateObservation) {
  return new Map(observation.definition.groups.flatMap((group) => group.components.map((component) => [
    component.id,
    {
      semantic: canonicalJson({ groupId: group.id, groupKey: group.key, component: fingerprintComponent(component, observation.enrichment, false) }),
      full: canonicalJson({ groupId: group.id, groupKey: group.key, groupDisplayName: group.displayName, groupDescription: group.description, component: fingerprintComponent(component, observation.enrichment, true) }),
    },
  ] as const)));
}

export function compareTemplateObservations(prev: TemplateObservation, next: TemplateObservation): Record<string, ComponentChange> {
  const before = lines(prev);
  const after = lines(next);
  return Object.fromEntries([...new Set([...before.keys(), ...after.keys()])].sort(compareIds).map((id) => {
    const previous = before.get(id);
    const current = after.get(id);
    const change: ComponentChange = !previous ? "added" : !current ? "removed"
      : previous.semantic !== current.semantic ? "changed"
        : previous.full !== current.full ? "cosmetic" : "unchanged";
    return [id, change];
  }));
}

/** Compatibility permits a reviewed re-stamp, never automatic acceptance. */
export function isEntryCompatible(prev: EntryLine, next: EntryLine): boolean {
  if (prev.entryPolicy !== next.entryPolicy || prev.component.inputs.length !== next.component.inputs.length) return false;
  return prev.component.inputs.every((input) => {
    const current = next.component.inputs.find((candidate) => candidate.key === input.key);
    if (!current || current.quantityKind !== input.quantityKind || current.type !== input.type) return false;
    const oldValue = ownValue(prev.enrichment, input.key);
    const newValue = ownValue(next.enrichment, input.key);
    // Every recognized unit within a quantity kind is convertible. Unknown or
    // unread units must be resolved before entries can be confirmed.
    return !!oldValue && !("status" in oldValue) && !!newValue && !("status" in newValue) &&
      unitsConvertible(input.quantityKind, oldValue.unit, newValue.unit);
  });
}
