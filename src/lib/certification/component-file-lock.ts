import { canTransferProductionReservation, type ProductionReservation } from "./production-reservation-policy";

/** Null means unreserved; an unresolved reservation stays protected. */
export function componentFileLocked({ claimedByRemovalId, reservation, correctionOpen }: {
  claimedByRemovalId?: string | null;
  reservation: ProductionReservation | null | undefined;
  correctionOpen: boolean;
}, now: number): boolean {
  return (reservation !== null && !canTransferProductionReservation(reservation, now)) ||
    (!!claimedByRemovalId && !correctionOpen);
}

/** Batch-level readers share the writer's reservation and correction rule. */
export function batchComponentFileLocked(batch: {
  id: string;
  productionEmissionsClaimedByRemovalId?: string | null;
  productionEmissionsClaimReservedBySubmissionId?: string | null;
}, reservations: readonly (ProductionReservation & { id: string })[], contenders: readonly {
  contenderKind: string; removalId: string; creditBatchIds: readonly string[];
}[], now = Date.now()): boolean {
  return componentFileLocked({
    claimedByRemovalId: batch.productionEmissionsClaimedByRemovalId,
    reservation: batch.productionEmissionsClaimReservedBySubmissionId
      ? reservations.find(row => row.id === batch.productionEmissionsClaimReservedBySubmissionId) : null,
    correctionOpen: contenders.some(contender => contender.contenderKind === "correction" &&
      contender.removalId === batch.productionEmissionsClaimedByRemovalId && contender.creditBatchIds.includes(batch.id)),
  }, now);
}
