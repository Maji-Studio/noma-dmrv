import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import { requireOrgScope, type Executor } from "./utils";
import { listEmissionEntries } from "./emission-entries";
import { getTemplateObservationById } from "./removal-template-observations";
import { emissionEntryCounts, type EntryObservation } from "@/lib/certification/emission-entry-rules";
import { canonicalUnit } from "@/lib/isometric/template-observations/units";

/** Shared stored-entry facts for the batch sheet, health and facility activity. */
export async function loadBatchEmissionEntryFacts(
  ctx: OrgContext, creditBatchId: string, observation: EntryObservation, executor: Executor = db,
) {
  requireOrgScope(ctx);
  const storedEntries = await listEmissionEntries(ctx, creditBatchId, executor);
  const previousObservations = new Map(
    await Promise.all(
      [...new Set(storedEntries.map((entry) => entry.observationId))].map(
        async (id) => [id, await getTemplateObservationById(ctx, id, executor)] as const,
      ),
    ),
  );
  const entries = storedEntries.map((entry) => {
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
  return { entries, previousObservations };
}
