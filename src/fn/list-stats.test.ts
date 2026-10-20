import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import { getOrderStatsFn } from "./orders";
import { getBiocharProductStatsFn } from "./biochar-products";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  facility: vi.fn(),
  orders: vi.fn(),
  products: vi.fn(),
}));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.context }));
vi.mock("@/data-access/utils", () => ({ requireOrgFacility: mocks.facility }));
vi.mock("@/data-access/order-stats", () => ({ getOrderStats: mocks.orders }));
vi.mock("@/data-access/biochar-product-stats", () => ({ getBiocharProductStats: mocks.products }));
vi.mock("@/data-access/orders", () => ({}));
vi.mock("@/data-access/biochar-products", () => ({}));
vi.mock("@/lib/operations/orders", () => ({}));
vi.mock("@/lib/operations/biochar-products", () => ({}));
vi.mock("@/lib/operations/runner", () => ({}));

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const CTX = { organizationId: "stats-org", userId: "stats-user", orgRole: "owner", isPlatformAdmin: false };
const ORDER_STATS = { totalOrders: 0, totalDeliveries: 0, totalQuantityKg: 0 };
const PRODUCT_STATS = { totalProducts: 0, totalWetMassKg: null, totalDryBiocharMassKg: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue(CTX);
  mocks.orders.mockResolvedValue(ORDER_STATS);
  mocks.products.mockResolvedValue(PRODUCT_STATS);
});

describe.each([
  { name: "orders", action: getOrderStatsFn, read: mocks.orders, stats: ORDER_STATS },
  { name: "biochar products", action: getBiocharProductStatsFn, read: mocks.products, stats: PRODUCT_STATS },
])("$name stats action", ({ action, read, stats }) => {
  it("checks the facility before the scoped read and returns ActionResult", async () => {
    expect(await action({ facilityId: FACILITY_ID })).toEqual({ success: true, data: stats });
    expect(mocks.facility).toHaveBeenCalledWith(CTX, FACILITY_ID);
    expect(read).toHaveBeenCalledWith(CTX, { facilityId: FACILITY_ID });
    expect(mocks.facility.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]);
  });

  it("supports organization-wide reads without a facility guard", async () => {
    expect(await action()).toEqual({ success: true, data: stats });
    expect(mocks.facility).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledWith(CTX, undefined);
  });

  it("does not forward list filters supplied by a caller", async () => {
    const input = { facilityId: FACILITY_ID, search: "one row", status: "ready" };
    expect(await action(input)).toEqual({ success: true, data: stats });
    expect(read).toHaveBeenCalledWith(CTX, { facilityId: FACILITY_ID });
  });

  it("rejects malformed facility IDs before accessing data", async () => {
    expect(await action({ facilityId: "invalid" })).toMatchObject({ success: false, code: "validation_failed" });
    expect(mocks.facility).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not read stats for a facility rejected by the org guard", async () => {
    mocks.facility.mockRejectedValue(new SafeError("Facility not found"));
    expect(await action({ facilityId: FACILITY_ID })).toMatchObject({ success: false, error: "Facility not found" });
    expect(read).not.toHaveBeenCalled();
  });
});
