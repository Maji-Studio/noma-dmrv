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
