import { selectRemovalEntries } from "@/lib/certification/removal-entry-selection";
import { omittedProductionSources } from "@/lib/certification/removal-emission-lines";
import type { OrgContext } from "@/lib/auth/server";
import { loadEmissionEntryReservations } from "@/data-access/emission-entry-contenders";
import type { BatchEmissionContext, LoadedBatchEmissionContext, EntryTemplateContext } from "./batch-emission-context";
import type { RemovalScope } from "./removal-scope";

export async function loadRemovalEntryContext(ctx: OrgContext, scope: RemovalScope, context: LoadedBatchEmissionContext, facility: EntryTemplateContext, frozenEntrySet?: { entryId: string; contentRevision: number }[]) {
  const { batchFacts: facts, carryContext } = context;
  if (!scope.removalId) return undefined;
  const observation = facility.templatesById[scope.memberBatches[0]?.removalTemplateId ?? ""]?.observation;
  if (!observation) return undefined;
  const selection = selectRemovalEntries({ removalId: scope.removalId, memberBatches: scope.memberBatches,
    applicationDates: scope.lineages.map(lineage => lineage.application.applicationDate), observation,
    ownEntries: Object.values(facts).flatMap(batch => batch.entries), carryEntries: carryContext?.entries ?? [],
    frozenEntrySet, contenders: Object.values(facts)[0]?.contenders ?? [],
    entriesWithoutRemoval: Object.values(facts).flatMap(batch => batch.entriesWithoutRemoval ?? []),
  });
  const { frozen, belongsToFrozenView } = selection;
  const reservations = await loadEmissionEntryReservations(ctx, selection.reservationIds);
  const contributions = selection.derive(reservations, Date.now());
  const batchFacts: BatchEmissionContext = Object.fromEntries(Object.entries(facts).map(([id, batch]) => {
    const member = scope.memberBatches.find((item) => item.id === id);
    const omittedAutomaticSources = omittedProductionSources(member?.productionEmissionsClaimedByRemovalId, scope.removalId!);
    return [id, { ...batch, ...(frozen ? { entries: batch.entries.filter(belongsToFrozenView), entriesWithoutRemoval: [] } : {}), omittedAutomaticSources, automaticFigures: Object.fromEntries(
      Object.entries(batch.automaticFigures).filter(([source]) => !omittedAutomaticSources.some((id) => id === source)),
    ) }];
  }));
  return { contributions, batchFacts, observationId: observation.id, semanticFingerprint: observation.semanticFingerprint };
}

export { frozenEntriesForAttempt } from "@/lib/certification/frozen-removal-entries";
