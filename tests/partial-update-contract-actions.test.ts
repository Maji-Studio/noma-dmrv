/**
 * The partial-update contract at the server-action seam (issue #770).
 *
 * `updateCustomerLocationFn` used to coerce every optional field with
 * `value || null`, so promoting a location to default ("set as default", a
 * two-key patch) silently erased its city, state/region, distance, and soil
 * temperature. The data-access layer already honours `undefined`; the action
 * is what has to stop inventing values.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateCustomerLocation = vi.fn();
const mockUpdateCustomerLocation = vi.fn();

vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn().mockResolvedValue({
    userId: "user-770",
    organizationId: "org_test_fixtures",
    orgRole: "owner",
    isPlatformAdmin: false,
  }),
}));

vi.mock("@/lib/operations/customer-locations", () => ({
  addCustomerLocation: { id: "add_customer_location" },
  updateCustomerLocation: { id: "update_customer_location" },
  deleteCustomerLocation: { id: "delete_customer_location" },
}));
vi.mock("@/lib/operations/customers", () => ({}));
vi.mock("@/data-access/customers", () => ({}));
vi.mock("@/lib/operations/runner", () => ({
  runOperationInProcess: (operation: { id: string }, ctx: unknown, input: Record<string, unknown>) =>
    operation.id === "add_customer_location"
      ? mockCreateCustomerLocation(ctx, input)
      : mockUpdateCustomerLocation(ctx, input.locationId, input),
}));

import {
  createCustomerLocationFn,
  updateCustomerLocationFn,
} from "@/fn/customers";

const LOCATION_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_ID = "66666666-6666-4666-8666-666666666666";

function lastPatch(): Record<string, unknown> {
  const call = mockUpdateCustomerLocation.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call![2] as Record<string, unknown>;
}

describe("updateCustomerLocationFn", () => {
  beforeEach(() => {
    mockUpdateCustomerLocation.mockReset();
    mockUpdateCustomerLocation.mockResolvedValue({ id: LOCATION_ID });
    mockCreateCustomerLocation.mockReset();
    mockCreateCustomerLocation.mockResolvedValue({ id: LOCATION_ID });
  });

  it("leaves every omitted field untouched when only the default flag changes", async () => {
    const result = await updateCustomerLocationFn({ expectedVersion: 1,
      locationId: LOCATION_ID,
      isDefault: true,
    });

    expect(result.success).toBe(true);
    const patch = lastPatch();
    expect(patch.isDefault).toBe(true);
    for (const key of [
      "name",
      "country",
      "stateRegion",
      "city",
      "address",
      "gpsLatitude",
      "gpsLongitude",
      "facilityDistances",
      "defaultSoilTemperatureC",
    ]) {
      expect(patch[key]).toBeUndefined();
    }
  });

  it("clears a field the operator actually emptied", async () => {
    await updateCustomerLocationFn({ expectedVersion: 1,
      locationId: LOCATION_ID,
      stateRegion: "",
      city: "",
      address: "",
      facilityDistances: [{ facilityId: LOCATION_ID, distanceKm: "", distanceSource: "manual" }],
      defaultSoilTemperatureC: "",
    } as never);

    expect(lastPatch()).toMatchObject({
      stateRegion: null,
      city: null,
      address: null,
      facilityDistances: [{ facilityId: LOCATION_ID, distanceKm: null, distanceSource: "manual" }],
      defaultSoilTemperatureC: null,
    });
  });

  it("keeps positive distances and zero soil temperature", async () => {
    await updateCustomerLocationFn({ expectedVersion: 1,
      locationId: LOCATION_ID,
      stateRegion: "Iringa",
      city: "Mafinga",
      facilityDistances: [{ facilityId: LOCATION_ID, distanceKm: 1, distanceSource: "manual" }],
      defaultSoilTemperatureC: 0,
    } as never);

    expect(lastPatch()).toMatchObject({
      stateRegion: "Iringa",
      city: "Mafinga",
      facilityDistances: [{ facilityId: LOCATION_ID, distanceKm: 1, distanceSource: "manual" }],
      defaultSoilTemperatureC: 0,
      // A present distance typed without explicit provenance is operator-entered.
    });
  });

  it("still normalizes empty strings to null on create", async () => {
    await createCustomerLocationFn({
      customerId: CUSTOMER_ID,
      name: "Block A",
      country: "Tanzania",
      stateRegion: "",
      city: "",
      address: "",
      gpsLatitude: -7.77,
      gpsLongitude: 35.69,
      isDefault: false,
    } as never);

    const call = mockCreateCustomerLocation.mock.calls.at(-1);
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({
      stateRegion: null,
      city: null,
      address: null,
    });
  });
});
