import { SafeError } from "@/lib/errors";

const DELIVERED_WET_MASS_REQUIRED_MESSAGE =
  "Wet mass must be greater than 0 for a delivered delivery";

/** Enforce the persisted status/mass invariant after partial updates merge. */
export function assertDeliveredWetMass(
  status: "upcoming" | "delivered",
  deliveredWetMassKg: number | null | undefined,
): void {
  if (
    status === "delivered" &&
    (deliveredWetMassKg == null ||
      !Number.isFinite(deliveredWetMassKg) ||
      deliveredWetMassKg <= 0)
  ) {
    throw new SafeError(DELIVERED_WET_MASS_REQUIRED_MESSAGE);
  }
}
