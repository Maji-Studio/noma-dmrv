import { allocateTrackedDryBiocharKg } from "./biochar-mass-accounting";
import { massGrams, splitGrams, GRAMS_PER_KG } from "@/data-access/delivery-allocation-math";
import { checkDeliveryCapacity } from "./calculations/delivery-inventory";
import { kgToTonnes } from "./calculations/unit-conversions";
import { formatFacilityDate, formatUtcDate } from "./date-utils";
import { DomainError, type DomainErrorCode } from "./domain-errors";

export function applicationRefusal(code: DomainErrorCode, path: string, message: string, meta?: Record<string, unknown>): DomainError {
  return new DomainError(code, message, { issues: [{ path: [path], code, message, ...(meta ? { meta } : {}) }] });
}
export function assertApplicationCapacity(capacityKg: number | null, alreadyAppliedWetKg: number, requestedWetKg: number): void {
  const availableGrams = capacityKg == null ? 0 : Math.max(0, massGrams(capacityKg) - massGrams(alreadyAppliedWetKg));
  if (capacityKg != null && massGrams(requestedWetKg) <= availableGrams) return;
  const check = checkDeliveryCapacity({ capacityKg, alreadyAppliedTons: kgToTonnes(alreadyAppliedWetKg), requestedTons: kgToTonnes(requestedWetKg) });
  throw applicationRefusal("conflict", "appliedWetMassKg", check.errorMessage ?? "Application exceeds the saved delivery wet mass.", {
    measure: "delivery_remaining_wet", availableWetKg: availableGrams / GRAMS_PER_KG, requestedWetKg, unit: "kg",
  });
}
export function resolveApplicationDryMassTons(input: {
  requestedWetKg: number; deliveryWetKg: number | null; deliveryDryBiocharKg: number | null; alreadyAppliedWetKg: number; alreadyAppliedDryKg: number;
}): number {
  const trackedDryKg = allocateTrackedDryBiocharKg({
    totalWetKg: input.deliveryWetKg, totalDryBiocharKg: input.deliveryDryBiocharKg,
    requestedWetKg: input.requestedWetKg, allocatedWetKg: input.alreadyAppliedWetKg,
    allocatedDryBiocharKg: input.alreadyAppliedDryKg,
  });
  if (trackedDryKg == null || input.deliveryWetKg == null || input.deliveryDryBiocharKg == null) throw applicationRefusal("conflict", "deliveryId", "Tracked dry biochar is not available. Save the delivery source allocations before recording an application.");
  assertApplicationCapacity(input.deliveryWetKg, input.alreadyAppliedWetKg, input.requestedWetKg);
  const wet = massGrams(input.deliveryWetKg);
  const dry = massGrams(input.deliveryDryBiocharKg);
  const cumulative = massGrams(input.alreadyAppliedWetKg) + massGrams(input.requestedWetKg);
  const allocated = splitGrams(cumulative, [dry, wet - dry])[0];
  return kgToTonnes(Math.max(0, allocated - massGrams(input.alreadyAppliedDryKg)) / GRAMS_PER_KG);
}
export function assertApplicationDate(date: Date, deliveredAt: Date, zone: string, deliveryCode: string, now = new Date()): void {
  const day = formatUtcDate(date);
  if (day < formatFacilityDate(deliveredAt, zone)) throw applicationRefusal("validation_failed", "applicationDate", `Application date cannot be before the delivery date of ${deliveryCode}`);
  if (day > formatFacilityDate(now, zone)) throw applicationRefusal("validation_failed", "applicationDate", "Application date is in the future. Choose today or an earlier date.");
}
