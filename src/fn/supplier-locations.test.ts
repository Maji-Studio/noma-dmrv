import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), ctx: { organizationId: "org", userId: "user" } }));
vi.mock("./with-action", () => ({ withAction: async (fn: (ctx: typeof mocks.ctx) => Promise<unknown>) => ({ success: true, data: await fn(mocks.ctx) }) }));
vi.mock("@/lib/operations/runner", () => ({ runOperationInProcess: mocks.run }));
vi.mock("@/lib/operations/suppliers", () => ({ createSupplier: {}, updateSupplier: {}, deleteSupplier: {}, archiveSupplier: {}, restoreSupplier: {} }));
vi.mock("@/lib/operations/supplier-locations", () => ({ addSupplierLocation: { id: "add_supplier_location" }, updateSupplierLocation: { id: "update_supplier_location" }, deleteSupplierLocation: { id: "delete_supplier_location" } }));
vi.mock("@/data-access/suppliers", () => ({ getSuppliers: vi.fn(), getSupplierById: vi.fn(), getSupplierLocationsBySupplier: vi.fn() }));
import { createSupplierLocationFn, updateSupplierLocationFn, deleteSupplierLocationFn } from "./suppliers";

const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
beforeEach(() => { mocks.run.mockReset(); mocks.run.mockResolvedValue({ id }); });
describe("supplier location app actions", () => {
  it("uses the runner for add and delete", async () => {
    await createSupplierLocationFn({ supplierId: id, country: "TZ", gpsLatitude: 0, gpsLongitude: 0, isDefault: false });
    expect(mocks.run).toHaveBeenLastCalledWith({ id: "add_supplier_location" }, mocks.ctx, expect.objectContaining({ supplierId: id, country: "TZ" }));
    expect(await deleteSupplierLocationFn({ locationId: id, expectedVersion: 1 })).toEqual({ success: true, data: undefined });
    expect(mocks.run).toHaveBeenLastCalledWith({ id: "delete_supplier_location" }, mocks.ctx, { locationId: id, expectedVersion: 1 });
  });
  it("keeps omitted optional text and explicitly clears empty or null text", async () => {
    const version = { locationId: id, expectedVersion: 1 };
    await updateSupplierLocationFn({ ...version, isDefault: true });
    expect(mocks.run).toHaveBeenLastCalledWith({ id: "update_supplier_location" }, mocks.ctx, expect.objectContaining({ ...version, name: undefined, city: undefined, stateRegion: undefined, address: undefined }));
    for (const clear of ["", null]) {
      await updateSupplierLocationFn({ ...version, name: clear, city: clear, stateRegion: clear, address: clear });
      expect(mocks.run).toHaveBeenLastCalledWith({ id: "update_supplier_location" }, mocks.ctx, expect.objectContaining({ name: null, city: null, stateRegion: null, address: null }));
    }
  });
});
