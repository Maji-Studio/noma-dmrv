/**
 * The partial-update contract at the schema seam (issue #770).
 *
 * `undefined` means omitted, `null` means explicit clear, `0` means zero —
 * for every clearable numeric field on an `update*Schema`. These are the
 * fields whose writers distinguish "not supplied" from "cleared", so a schema
 * that folds one into the other is the whole bug.
 */

import { describe, expect, it } from "vitest";
import { updateApplicationInput } from "@/schemas/application-input";
import { updateCustomerLocationSchema } from "@/schemas/customers";
import { updateFeedstockSchema } from "@/schemas/feedstocks";
import { updateOrderSchema } from "@/schemas/orders";
import { updateSupplierLocationSchema } from "@/schemas/suppliers";
import {
  clearableNumber,
  clearablePositiveNumber,
  optionalPositiveNumber,
  toClearableNumber,
} from "@/schemas/helpers";

const FEEDSTOCK_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const APPLICATION_ID = "33333333-3333-4333-8333-333333333333";
const LOCATION_ID = "44444444-4444-4444-8444-444444444444";

function parsed<T>(schema: { parse: (input: unknown) => T }, input: unknown): T {
  return schema.parse(input);
}

describe("toClearableNumber", () => {
  it("keeps omitted as undefined and treats empty input as an explicit clear", () => {
    expect(toClearableNumber(undefined)).toBeUndefined();
    expect(toClearableNumber(null)).toBeNull();
    expect(toClearableNumber("")).toBeNull();
    expect(toClearableNumber("   ")).toBeNull();
  });

  it("keeps zero and populated values", () => {
    expect(toClearableNumber(0)).toBe(0);
    expect(toClearableNumber("0")).toBe(0);
    expect(toClearableNumber("12.5")).toBe(12.5);
  });

  it("differs from optionalPositiveNumber only on the omitted case", () => {
    // `optionalPositiveNumber` folds omitted into cleared, which is right for a
    // create and wrong for a patch. Everything else has to match.
    expect(optionalPositiveNumber.parse(undefined)).toBeNull();
    expect(clearablePositiveNumber.parse(undefined)).toBeUndefined();
    expect(optionalPositiveNumber.parse("")).toBeNull();
    expect(clearablePositiveNumber.parse("")).toBeNull();
    expect(optionalPositiveNumber.parse(0)).toBe(0);
    expect(clearablePositiveNumber.parse(0)).toBe(0);
  });

  it("still rejects an out-of-range clearable value", () => {
    expect(clearablePositiveNumber.safeParse(-1).success).toBe(false);
    expect(clearableNumber.safeParse("not a number").success).toBe(false);
  });
});

describe("updateFeedstockSchema transport distance", () => {
  it("leaves an omitted distance undefined so the derived leg keeps its value", () => {
    const result = parsed(updateFeedstockSchema, {
      feedstockId: FEEDSTOCK_ID,
      expectedVersion: 1,
      notes: "Unrelated edit",
    });

    expect(result.transportDistanceKm).toBeUndefined();
    expect("transportDistanceKm" in result).toBe(false);
  });

  it("treats an empty distance input as an explicit clear", () => {
    expect(
      parsed(updateFeedstockSchema, {
        feedstockId: FEEDSTOCK_ID,
      expectedVersion: 1,
        transportDistanceKm: "",
      }).transportDistanceKm,
    ).toBeNull();
    expect(
      parsed(updateFeedstockSchema, {
        feedstockId: FEEDSTOCK_ID,
      expectedVersion: 1,
        transportDistanceKm: null,
      }).transportDistanceKm,
    ).toBeNull();
  });

  it("keeps a populated distance and a zero distance", () => {
    expect(
      parsed(updateFeedstockSchema, {
        feedstockId: FEEDSTOCK_ID,
      expectedVersion: 1,
        transportDistanceKm: "85.5",
      }).transportDistanceKm,
    ).toBe(85.5);
    expect(
      parsed(updateFeedstockSchema, {
        feedstockId: FEEDSTOCK_ID,
      expectedVersion: 1,
        transportDistanceKm: 0,
      }).transportDistanceKm,
    ).toBe(0);
  });
});

describe("updateOrderSchema removed price fields", () => {
  it("strips removed price keys from an order edit", () => {
    const result = parsed(updateOrderSchema, { expectedVersion: 1,
      orderId: ORDER_ID,
      value: null,
    });
    expect(result).not.toHaveProperty("value");
    expect(result).not.toHaveProperty("currency");
  });
});

describe("updateApplicationInput soil temperature", () => {
  it("separates omitted, cleared and zero", () => {
    expect(
      parsed(updateApplicationInput, { expectedVersion: 1, applicationId: APPLICATION_ID })
        .soilTemperatureC,
    ).toBeUndefined();
    expect(
      parsed(updateApplicationInput, { expectedVersion: 1,
        applicationId: APPLICATION_ID,
        soilTemperatureC: null,
      }).soilTemperatureC,
    ).toBeNull();
    // Zero °C is a real soil temperature, not a missing one.
    expect(
      parsed(updateApplicationInput, { expectedVersion: 1,
        applicationId: APPLICATION_ID,
        soilTemperatureC: 0,
      }).soilTemperatureC,
    ).toBe(0);
    expect(
      parsed(updateApplicationInput, { expectedVersion: 1,
        applicationId: APPLICATION_ID,
        soilTemperatureC: 25,
      }).soilTemperatureC,
    ).toBe(25);
  });
});

describe("customer and supplier location patches", () => {
  it("leaves an omitted distance and soil temperature untouched", () => {
    const result = parsed(updateCustomerLocationSchema, { expectedVersion: 1,
      locationId: LOCATION_ID,
      isDefault: true,
    });

    expect(result.distanceFromFacilityKm).toBeUndefined();
    expect(result.defaultSoilTemperatureC).toBeUndefined();
    expect(result.stateRegion).toBeUndefined();
    expect(result.city).toBeUndefined();
  });

  it("clears a customer-location distance on empty input and keeps zero", () => {
    expect(
      parsed(updateCustomerLocationSchema, { expectedVersion: 1,
        locationId: LOCATION_ID,
        distanceFromFacilityKm: "",
        defaultSoilTemperatureC: "",
      }),
    ).toMatchObject({
      distanceFromFacilityKm: null,
      defaultSoilTemperatureC: null,
    });
    expect(
      parsed(updateCustomerLocationSchema, { expectedVersion: 1,
        locationId: LOCATION_ID,
        distanceFromFacilityKm: 1,
        defaultSoilTemperatureC: 0,
      }),
    ).toMatchObject({
      distanceFromFacilityKm: 1,
      defaultSoilTemperatureC: 0,
    });
  });

  it("applies the same contract to supplier distances", () => {
    expect(
      parsed(updateSupplierLocationSchema, { expectedVersion: 1, locationId: LOCATION_ID })
        .distanceFromFacilityKm,
    ).toBeUndefined();
    expect(
      parsed(updateSupplierLocationSchema, { expectedVersion: 1,
        locationId: LOCATION_ID,
        distanceFromFacilityKm: "",
      }).distanceFromFacilityKm,
    ).toBeNull();
  });
});
