import { afterEach, describe, expect, it } from "vitest";
import type { ApplicationDeliveryOption } from "./mass-utils";
import {
  applicationStockCues,
  formatApplicationDeliveryHelperText,
  formatApplicationDeliveryOptionLabel,
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
  it("shows wet and dry mass together", () => {
    expect(getApplicationDeliveryMassLabel(delivery())).toBe(
      "850 kg wet, 820 kg dry biochar",
    );
  });

  it("keeps a missing mass basis visible", () => {
    expect(
      getApplicationDeliveryMassLabel(
        delivery({ massDryKg: null, moistureContentPercent: null }),
      ),
    ).toBe(
      "850 kg wet, dry biochar not available",
    );
  });

  it("uses the bin name and never exposes internal record codes", () => {
    const label = formatApplicationDeliveryOptionLabel(delivery());

    expect(label).toContain("Finished product north");
    expect(label).toContain(
      "850 kg wet, 820 kg dry biochar",
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
      "Remaining now: 800 kg wet, 775 kg dry biochar",
    );
  });
});

describe("application stock cues", () => {
  it("shows the delivery's remaining stock and what it offers on create", () => {
    expect(
      applicationStockCues({
        delivery: delivery({ alreadyAppliedWetKg: 50, alreadyAppliedDryKg: 45 }),
        availableKg: 800,
        isEditMode: false,
      }),
    ).toEqual({
      deliveryCue: "Remaining now: 800 kg wet, 775 kg dry biochar",
      appliedMassCue: "800 kg available from this delivery",
    });
  });

  it("shows one figure on edit: what is available to this application", () => {
    // 1,000 kg delivered, this application already holds 400 kg of it.
    expect(
      applicationStockCues({
        delivery: delivery({
          deliveredWetMassKg: 1_000,
          alreadyAppliedWetKg: 400,
          alreadyAppliedDryKg: 180,
        }),
        availableKg: 1_000,
        isEditMode: true,
      }),
    ).toEqual({
      deliveryCue: undefined,
      appliedMassCue: "1,000 kg available to this application",
    });
  });

  it("gives no cues before a delivery is chosen", () => {
    expect(
      applicationStockCues({
        delivery: undefined,
        availableKg: null,
        isEditMode: false,
      }),
    ).toEqual({ deliveryCue: undefined, appliedMassCue: undefined });
  });
});

describe("application delivery option day", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("names the delivery's day on its facility clock, not the viewer's", () => {
    // 01:30 on May 17 in Dar es Salaam is still May 16 for a New York viewer.
    process.env.TZ = "America/New_York";
    const label = formatApplicationDeliveryOptionLabel(
      delivery({ deliveryDate: new Date("2026-05-16T22:30:00.000Z"), deliveryDay: "2026-05-17" }),
    );
    expect(label).toContain("May 17, 2026");
    expect(label).not.toContain("May 16, 2026");
  });

  it("falls back to the default facility zone without a facility day", () => {
    process.env.TZ = "America/New_York";
    const label = formatApplicationDeliveryOptionLabel(
      delivery({ deliveryDate: new Date("2026-05-17T02:00:00.000Z"), deliveryDay: null }),
    );
    expect(label).toContain("May 17, 2026");
  });
});
