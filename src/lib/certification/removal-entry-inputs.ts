import type { EntryObservation } from "./emission-entry-rules";
import { canonicalUnit } from "@/lib/isometric/template-observations/units";
import { deriveRemovalEntryContributions, isLiveEntryReservation, type RemovalEntryFact } from "./removal-emission-contributions";

type Reservation = Parameters<typeof isLiveEntryReservation>[0] & { submissionId: string; removalId: string };

/** One reservation clock and monitored-input contract for reads and transactional zero checks. */
export function deriveRemovalEntryInputs(args: Omit<Parameters<typeof deriveRemovalEntryContributions>[0], "lineSources" | "monitoredInputs"> & {
  observation: EntryObservation;
  reservations: readonly Reservation[];
  nowMs: number;
  frozen?: boolean;
}) {
  const owners = new Map(args.reservations.map((reservation) => [reservation.submissionId, {
    removalId: reservation.removalId, live: isLiveEntryReservation(reservation, args.nowMs),
  }]));
  return deriveRemovalEntryContributions({
    ...args,
    entries: args.entries.map((entry): RemovalEntryFact => {
      const owner = entry.sendReservedBySubmissionId ? owners.get(entry.sendReservedBySubmissionId) : undefined;
      return { ...entry, reservedByRemovalId: owner?.live ? owner.removalId : args.frozen && !entry.heldForRemovalId ? args.removalId : null,
        reservationKnownInactive: !owner?.live };
    }),
    lineSources: args.observation.lineSources,
    monitoredInputs: args.observation.definition.groups.flatMap((group) => group.components.flatMap((component) => component.inputs.flatMap((input) => {
      if (input.type !== "monitored") return [];
      const enriched = args.observation.enrichment[component.id]?.[input.key];
      const unit = enriched && !("status" in enriched) ? canonicalUnit(input.quantityKind, enriched.unit) : undefined;
      return unit ? [{ componentId: component.id, componentDisplayName: component.displayName, inputKey: input.key, unit }] : [];
    }))),
  });
}
