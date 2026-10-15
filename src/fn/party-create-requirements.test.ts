import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ customer: vi.fn(), supplier: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn().mockResolvedValue({
    userId: "test-user", organizationId: "test-org", orgRole: "owner", isPlatformAdmin: false,
  }),
}));
vi.mock("@/data-access/customers", () => ({ createCustomerWithLocations: mocks.customer }));
vi.mock("@/data-access/suppliers", () => ({ createSupplierWithLocations: mocks.supplier }));
vi.mock("@/data-access/code-generator", () => ({
  CODE_CONFLICT_MESSAGES: { customer: "Duplicate customer" },
  withAutoCode: (_ctx: unknown, _prefix: unknown, _table: unknown, _column: unknown, _facility: unknown, write: (code: string) => unknown) => write("TEST-001"),
}));
import { createCustomerFn, createCustomerWithLocationsFn } from "./customers";
import { createSupplierFn, createSupplierWithLocationsFn } from "./suppliers";

beforeEach(() => {
  mocks.customer.mockReset().mockResolvedValue({ customer: { id: "customer" }, locations: [{ id: "location" }] });
  mocks.supplier.mockReset().mockResolvedValue({ id: "supplier" });
});

it.each([createCustomerFn, createCustomerWithLocationsFn, createSupplierFn, createSupplierWithLocationsFn])(
  "refuses empty or missing locations at every callable create boundary", async (action) => {
    const parent = { customer: { name: "Customer" }, supplier: { name: "Supplier" } };
    for (const input of [parent, { ...parent, locations: [] }, { name: "Old bare create" }]) {
      expect(await action(input as never)).toMatchObject({ success: false, code: "validation_failed" });
    }
    expect(mocks.customer).not.toHaveBeenCalled();
    expect(mocks.supplier).not.toHaveBeenCalled();
  },
);

it("routes both aliases through the composite writer", async () => {
  const locations = [{ name: "Site", country: "Tanzania", gpsLatitude: 0, gpsLongitude: 0, isDefault: true }];
  expect(await createCustomerFn({ customer: { name: "Customer" }, locations })).toMatchObject({ success: true, data: { id: "customer" } });
  expect(await createSupplierFn({ supplier: { name: "Supplier" }, locations })).toMatchObject({ success: true, data: { id: "supplier" } });
  expect(mocks.customer.mock.calls[0][1].locations).toHaveLength(1);
  expect(mocks.supplier.mock.calls[0][1].locations).toHaveLength(1);
});
