import { deliveryWetMassRequiredMessage, hasStorableDeliveredWetMass } from '@/lib/delivery-wet-mass';
import { SafeError } from '@/lib/errors';

/** Only delivered positive wet mass physically draws from product stock. */
export function deliveryDrawsStock(
  status: string | null | undefined,
  deliveredWetMassKg: number | null | undefined,
): deliveredWetMassKg is number {
  return (
    status === "delivered" &&
    hasStorableDeliveredWetMass(deliveredWetMassKg)
  );
}

/** A persisted delivered row must satisfy the same positive-mass predicate. */
export function assertDeliveredWetMass(
  status: string | null | undefined,
  deliveredWetMassKg: number | null | undefined,
  deliveryCode: string,
): void {
  if (
    status === "delivered" &&
    !deliveryDrawsStock(status, deliveredWetMassKg)
  ) {
    throw new SafeError(deliveryWetMassRequiredMessage(deliveryCode));
  }
}
