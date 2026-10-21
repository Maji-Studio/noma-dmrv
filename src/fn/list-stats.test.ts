import { beforeEach, describe, expect, it, vi } from "vitest";
import { SafeError } from "@/lib/errors";
import { getOrderStatsFn } from "./orders";
import { getBiocharProductStatsFn } from "./biochar-products";
import { getFacilityStatsFn } from "./facilities";
import { getReactorStatsFn } from "./reactors";
import { getSupplierStatsFn } from "./suppliers";
import { getFormulationStatsFn } from "./formulations";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  facility: vi.fn(),
  orders: vi.fn(),
  products: vi.fn(),
  facilities: vi.fn(),
  reactors: vi.fn(),
  suppliers: vi.fn(),
  formulations: vi.fn(),
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

vi.mock("@/data-access/facility-stats", () => ({ getFacilityStats: mocks.facilities }));
vi.mock("@/data-access/reactor-stats", () => ({ getReactorStats: mocks.reactors }));
vi.mock("@/data-access/supplier-stats", () => ({ getSupplierStats: mocks.suppliers }));
vi.mock("@/data-access/formulation-stats", () => ({ getFormulationStats: mocks.formulations }));
vi.mock("@/data-access/facilities", () => ({}));
vi.mock("@/data-access/reactors", () => ({}));
vi.mock("@/data-access/suppliers", () => ({}));
vi.mock("@/data-access/formulations", () => ({}));
vi.mock("@/data-access/code-generator", () => ({}));
vi.mock("@/lib/operations/suppliers", () => ({}));
vi.mock("@/lib/operations/supplier-locations", () => ({}));
vi.mock("@/lib/operations/formulations", () => ({}));

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";
const CTX = { organizationId: "stats-org", userId: "stats-user", orgRole: "admin", isPlatformAdmin: false };
const ORDER_STATS = { totalOrders: 0, totalDeliveries: 0, totalQuantityKg: 0 };
const PRODUCT_STATS = { totalProducts: 0, totalWetMassKg: null, totalDryBiocharMassKg: null };

const FACILITY_STATS = { totalFacilities: 0, totalReactors: 0, totalStorageBins: 0, totalFeedstockWetKg: 0 };
const REACTOR_STATS = { totalReactors: 0, totalNominalThroughputTph: null };
const SUPPLIER_STATS = { totalSuppliers: 0 };
const FORMULATION_STATS = { totalFormulations: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue(CTX);
  mocks.orders.mockResolvedValue(ORDER_STATS);
  mocks.products.mockResolvedValue(PRODUCT_STATS);
  mocks.facilities.mockResolvedValue(FACILITY_STATS);
  mocks.reactors.mockResolvedValue(REACTOR_STATS);
  mocks.suppliers.mockResolvedValue(SUPPLIER_STATS);
  mocks.formulations.mockResolvedValue(FORMULATION_STATS);
});

describe.each([
  { name: "reactors", action: getReactorStatsFn, read: mocks.reactors, stats: REACTOR_STATS },
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
    mocks.facility.mockRejectedValue(new SafeError("Facility was not found."));
    expect(await action({ facilityId: FACILITY_ID })).toMatchObject({ success: false, error: "Facility was not found." });
    expect(read).not.toHaveBeenCalled();
  });
});

const archivedActions = [
  { name: "facilities", action: getFacilityStatsFn, read: mocks.facilities, stats: FACILITY_STATS },
  { name: "suppliers", action: getSupplierStatsFn, read: mocks.suppliers, stats: SUPPLIER_STATS },
  { name: "formulations", action: getFormulationStatsFn, read: mocks.formulations, stats: FORMULATION_STATS },
];

describe.each(archivedActions)("$name stats action", ({ action, read, stats }) => {
  it("supports default organization-wide reads and returns ActionResult", async () => {
    expect(await action()).toEqual({ success: true, data: stats });
    expect(read).toHaveBeenCalledWith(CTX, undefined);
    expect(mocks.facility).not.toHaveBeenCalled();
  });

  it.each([false, true])("forwards the validated archived toggle: %s", async (archived) => {
    expect(await action({ archived })).toEqual({ success: true, data: stats });
    expect(read).toHaveBeenCalledWith(CTX, { archived });
  });

  it("does not forward list filters supplied by a caller", async () => {
    const input = { archived: true, search: "one row", country: "CH", facilityId: FACILITY_ID, page: 2 };
    expect(await action(input)).toEqual({ success: true, data: stats });
    expect(read).toHaveBeenCalledWith(CTX, { archived: true });
  });

  it("rejects malformed archived flags before accessing data", async () => {
    // @ts-expect-error exercise an untrusted Server Action caller
    expect(await action({ archived: "true" })).toMatchObject({ success: false, code: "validation_failed" });
    expect(read).not.toHaveBeenCalled();
  });
});

describe.each([
  ...archivedActions,
  { name: "reactors", action: getReactorStatsFn, read: mocks.reactors },
])("$name stats action failures", ({ action, read }) => {
  it("does not read data when authentication fails", async () => {
    mocks.context.mockRejectedValue(new SafeError("Sign in required."));
    expect(await action()).toMatchObject({ success: false, error: "Sign in required." });
    expect(read).not.toHaveBeenCalled();
  });

  it("returns an ActionResult failure when the read fails", async () => {
    read.mockRejectedValue(new SafeError("Stats are unavailable."));
    expect(await action()).toMatchObject({ success: false, error: "Stats are unavailable." });
  });
});
