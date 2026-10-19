import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ customer: vi.fn(), supplier: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  requireOrgContext: vi.fn().mockResolvedValue({
    userId: "test-user", organizationId: "test-org", orgRole: "owner", isPlatformAdmin: false,
  }),
}));
vi.mock("@/lib/operations/runner", () => ({
  runOperationInProcess: (operation: { id: string }, ctx: unknown, input: unknown) => operation.id === "create_customer" ? mocks.customer(ctx, input) : mocks.supplier(ctx, input),
}));
import { createCustomerWithLocationsFn } from "./customers";
import { createSupplierWithLocationsFn } from "./suppliers";

beforeEach(() => {
  mocks.customer.mockReset().mockResolvedValue({ customer: { id: "customer" }, locations: [{ id: "location" }] });
  mocks.supplier.mockReset().mockResolvedValue({ supplier: { id: "supplier" }, locations: [{ id: "location" }] });
});

it.each([createCustomerWithLocationsFn, createSupplierWithLocationsFn])(
  "refuses empty or missing locations at every callable create boundary", async (action) => {
    const parent = { customer: { name: "Customer" }, supplier: { name: "Supplier" } };
    for (const input of [parent, { ...parent, locations: [] }, { name: "Old bare create" }]) {
      expect(await action(input as never)).toMatchObject({ success: false, code: "validation_failed" });
    }
    expect(mocks.customer).not.toHaveBeenCalled();
    expect(mocks.supplier).not.toHaveBeenCalled();
  },
);

it("creates both parties through their composite writers", async () => {
  const locations = [{ name: "Site", country: "Tanzania", gpsLatitude: 0, gpsLongitude: 0, isDefault: true }];
  expect(await createCustomerWithLocationsFn({ customer: { name: "Customer" }, locations })).toMatchObject({ success: true, data: { customer: { id: "customer" } } });
  expect(await createSupplierWithLocationsFn({ supplier: { name: "Supplier" }, locations })).toMatchObject({ success: true, data: { id: "supplier" } });
  expect(mocks.customer.mock.calls[0][1].locations).toHaveLength(1);
  expect(mocks.supplier.mock.calls[0][1].locations).toHaveLength(1);
});
