import { SOURCE_IDS } from "@/lib/isometric/template-observations/catalog-sources";
import { SOURCE_BUCKETS } from "@/lib/isometric/utils/aggregation";
import { productionClaimContribution } from "./production-claim-policy";
import type { OrgContext } from "@/lib/auth/server";
import { loadEmissionEntryReservations } from "@/data-access/emission-entry-contenders";
import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import { deriveRemovalEntryContributions, deriveRemovalEntryWindow, isLiveEntryReservation } from "@/lib/certification/removal-emission-contributions";
import { canonicalUnit } from "@/lib/isometric/template-observations/units";
import type { BatchEmissionContext } from "./batch-emission-context";
import type { FacilityCertifierFacts } from "./facility-certifier-facts";
import type { RemovalScope } from "./removal-scope";

export async function loadRemovalEntryContext(ctx: OrgContext, scope: RemovalScope, facts: BatchEmissionContext, facility: FacilityCertifierFacts) {
  if (!emissionsEntriesEnabled() || !scope.removalId) return undefined;
  const observation = facility.templatesById[scope.memberBatches[0]?.removalTemplateId ?? ""]?.observation;
  if (!observation) return undefined;
  const entries = Object.values(facts).flatMap((batch) => batch.entries);
  const contenders = Object.values(facts)[0]?.contenders ?? [];
  const reservations = await loadEmissionEntryReservations(ctx,
    [...new Set(entries.flatMap((entry) => entry.sendReservedBySubmissionId ? [entry.sendReservedBySubmissionId] : []))]);
  const nowMs = Date.now();
  const reservationOwners = new Map(reservations.map((reservation) => [reservation.submissionId, {
    removalId: reservation.removalId, live: isLiveEntryReservation(reservation, nowMs),
  }]));
  const contributions = deriveRemovalEntryContributions({
    removalId: scope.removalId, memberBatchIds: scope.memberBatches.map((batch) => batch.id),
    window: deriveRemovalEntryWindow(scope.memberBatches, scope.lineages.map((lineage) => lineage.application.applicationDate)),
    contenders, entries: entries.map((entry) => {
      const reservation = entry.sendReservedBySubmissionId ? reservationOwners.get(entry.sendReservedBySubmissionId) : undefined;
      return { ...entry, reservedByRemovalId: reservation?.live ? reservation.removalId : null,
        reservationKnownInactive: reservation?.live === false };
    }),
    lineSources: observation.lineSources,
    monitoredInputs: observation.definition.groups.flatMap((group) => group.components.flatMap((component) => component.inputs.flatMap((input) => {
      if (input.type !== "monitored") return [];
      const enriched = observation.enrichment[component.id]?.[input.key];
      const unit = enriched && !("status" in enriched) ? canonicalUnit(input.quantityKind, enriched.unit) : undefined;
      return unit ? [{ componentId: component.id, inputKey: input.key, unit }] : [];
    }))),
  });
  // Automatic production figures obey the batch claim; delivery/stored figures remain scoped by compilation.
  for (const batch of scope.memberBatches) {
    if (productionClaimContribution(batch.productionEmissionsClaimedByRemovalId, scope.removalId) !== "delivery-only") continue;
    const automatic = facts[batch.id]?.automaticFigures;
    if (automatic) for (const key of Object.keys(SOURCE_IDS) as (keyof typeof SOURCE_IDS)[]) {
      if (SOURCE_BUCKETS[key] === "production") delete automatic[SOURCE_IDS[key]];
    }
  }
  return { contributions, observationId: observation.id, semanticFingerprint: observation.semanticFingerprint };
}
