import { describe, expect, it } from "vitest";
import {
  createCustomerLocationSchema,
  customerLocationFormSchema,
  updateCustomerLocationSchema,
} from "./customers";

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";
const LOCATION_ID = "00000000-0000-4000-8000-000000000002";

const locationInput = {
  name: "Coffee Farm",
  country: "Tanzania",
  gpsLatitude: -3.3349,
  gpsLongitude: 37.3404,
};

describe("customer location site description", () => {
  it("accepts a blank site description in the form", () => {
    expect(
      customerLocationFormSchema.safeParse({
        ...locationInput,
        address: "",
      }).success,
    ).toBe(true);
  });

  it("allows create and update payloads to omit the site description", () => {
    expect(
      createCustomerLocationSchema.safeParse({
        customerId: CUSTOMER_ID,
        ...locationInput,
      }).success,
    ).toBe(true);
    expect(
      updateCustomerLocationSchema.safeParse({
        locationId: LOCATION_ID,
      }).success,
    ).toBe(true);
  });

  it("still accepts a site description when the operator writes one", () => {
    const result = customerLocationFormSchema.safeParse({
      ...locationInput,
      address: "Second gate past the church, red soil parcel",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.address).toBe(
      "Second gate past the church, red soil parcel",
    );
  });

  it("rejects a site description longer than 500 characters", () => {
    const result = customerLocationFormSchema.safeParse({
      ...locationInput,
      address: "a".repeat(501),
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe(
      "Site description must be less than 500 characters",
    );
  });
});
