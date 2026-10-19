import type { listEmissionEntries } from "@/data-access/emission-entries";
import { emissionEntryCounts, type EntryObservation } from "./emission-entry-rules";
import { canonicalUnit } from "@/lib/isometric/template-observations/units";

/** Shared entry compatibility and evidence facts for detail and bulk reads. */
export function deriveEmissionEntryFacts(
  storedEntries: Awaited<ReturnType<typeof listEmissionEntries>>,
  observation: EntryObservation,
  previousObservations: ReadonlyMap<string, EntryObservation | null>,
) {
  return storedEntries.map((entry) => {
    const previous = previousObservations.get(entry.observationId);
    const status = previous
      ? emissionEntryCounts(previous, observation, entry.componentId)
      : { counts: false, reason: "Enter the values again for the current template line.", canConfirm: false };
    const component = observation.definition.groups
      .flatMap((group) => group.components)
      .find((component) => component.id === entry.componentId);
    const unitMismatch = entry.values.some((value) => {
      const input = component?.inputs.find((input) => input.key === value.inputKey);
      const enriched = observation.enrichment[entry.componentId]?.[value.inputKey];
      return (
        input &&
        enriched &&
        !("status" in enriched) &&
        value.unit !== canonicalUnit(input.quantityKind, enriched.unit)
      );
    });
    const value = entry.values.length === 1 ? entry.values[0] : null;
    return {
      ...entry,
      ...status,
      unitMismatch,
      hasEvidence: entry.documentCount > 0,
      total: value ? { magnitude: value.magnitude, unit: value.unit } : null,
    };
  });
}
