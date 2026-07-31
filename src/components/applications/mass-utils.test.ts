import { describe, expect, it } from "vitest";
import type { ApplicationDeliveryOption } from "./mass-utils";
import {
  formatApplicationDeliveryHelperText,
  formatApplicationDeliveryOptionLabel,
  getManualDryAppliedMassError,
  getApplicationDeliveryMassLabel,
} from "./mass-utils";

function delivery(
  overrides: Partial<ApplicationDeliveryOption> = {},
): ApplicationDeliveryOption {
  return {
    id: "delivery-id",
    code: "DL-26-004",
    status: "delivered",
    deliveryDate: "2026-05-17",
    orderCode: "OR-26-003",
    formulationName: "Moshi Raw Biochar Curing Pad",
    productBinName: "Finished product north",
    massDryKg: 820,
    deliveredWetMassKg: 850,
    orderQuantityKg: 900,
    moistureContentPercent: 3.529,
    defaultSoilTemperatureC: null,
    facilityDefaultSoilTemperatureC: null,
    destinationGpsLatitude: null,
    destinationGpsLongitude: null,
    alreadyAppliedWetKg: 0,
    alreadyAppliedDryKg: 0,
    ...overrides,
  };
}

describe("application delivery option mass", () => {
  it("returns a blocking error when manual dry mass exceeds wet mass", () => {
    expect(getManualDryAppliedMassError(1_000, 1_000.002)).toBe(
      "Dry mass cannot exceed wet mass.",
    );
  });

  it("clears the manual dry-mass error at or below wet mass", () => {
    expect(getManualDryAppliedMassError(1_000, 1_000.001)).toBeUndefined();
    expect(getManualDryAppliedMassError(1_000, 900)).toBeUndefined();
  });

  it("shows wet and dry mass together", () => {
    expect(getApplicationDeliveryMassLabel(delivery())).toBe(
      "Wet biochar product: 850kg | Dry biochar: 820kg",
    );
  });

  it("keeps a missing mass basis visible", () => {
    expect(
      getApplicationDeliveryMassLabel(
        delivery({ massDryKg: null, moistureContentPercent: null }),
      ),
    ).toBe(
      "Wet biochar product: 850kg | Dry biochar: Not recorded",
    );
  });

  it("uses the bin name and never exposes internal record codes", () => {
    const label = formatApplicationDeliveryOptionLabel(delivery());

    expect(label).toContain("Finished product north");
    expect(label).toContain(
      "Wet biochar product: 850kg | Dry biochar: 820kg",
    );
    expect(label).not.toContain("DL-26-004");
    expect(label).not.toContain("OR-26-003");
  });

  it("shows the delivery's remaining unapplied wet and dry mass below the field", () => {
    const option = delivery({
      alreadyAppliedWetKg: 50,
      alreadyAppliedDryKg: 45,
    });

    expect(formatApplicationDeliveryHelperText(option)).toBe(
      "Remaining wet mass: 800kg | dry mass: 775kg",
    );
  });
});
