/** DB-free snapshot contract: every query is mocked and no database is opened. */
import { beforeEach, expect, it, vi } from "vitest";
import { findApiOrderBalance } from "./api-order-balance";
import { isStockOverdraw } from "@/lib/stock-overdraw";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), order: vi.fn(), allocation: vi.fn(), scope: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("./api-orders", () => ({ findApiOrder: mocks.order }));
vi.mock("./delivery-order-balance", () => ({ readDeliveryOrderAllocation: mocks.allocation }));
vi.mock("./utils", () => ({ requireOrgScope: mocks.scope }));

const ctx = { organizationId: "org", userId: "user", orgRole: "owner" as const, isPlatformAdmin: false };
const id = "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b";

const tx = { snapshot: "one" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(async (read) => read(tx));
  mocks.order.mockResolvedValue({ id, quantityKg: 100, archivedAt: null });
  mocks.allocation.mockResolvedValue({ allocatedWetKg: 25, deliveryCount: 1, fulfillmentStatus: "partial" });
});

it("reads the order first and the allocation through the same read-only repeatable-read transaction", async () => {
  expect(await findApiOrderBalance(ctx, { id })).toEqual({ orderId: id, quantityKg: 100, deliveredWetMassKg: 25, remainingWetMassKg: 75, fulfillmentStatus: "partial" });
  expect(mocks.scope).toHaveBeenCalledWith(ctx);
  expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
  expect(mocks.order).toHaveBeenCalledWith(ctx, { id }, tx);
  expect(mocks.allocation).toHaveBeenCalledWith(ctx, tx, id, { orderQuantityKg: 100, includeArchived: false });
  expect(mocks.order.mock.invocationCallOrder[0]).toBeLessThan(mocks.allocation.mock.invocationCallOrder[0]);
});

it("includes archived deliveries only when the order is archived", async () => {
  mocks.order.mockResolvedValue({ id, quantityKg: 100, archivedAt: new Date("2026-10-01T00:00:00Z") });
  expect(await findApiOrderBalance(ctx, { id })).toMatchObject({ deliveredWetMassKg: 25, remainingWetMassKg: 75 });
  expect(mocks.allocation).toHaveBeenCalledWith(ctx, tx, id, { orderQuantityKg: 100, includeArchived: true });
});

it("publishes decimal subtraction without float noise and accepts that remainder in the write-side check", async () => {
  const quantityKg = 1234.5;
  const deliveredKg = 1000.1;
  mocks.order.mockResolvedValue({ id, quantityKg, archivedAt: null });
  mocks.allocation.mockResolvedValue({ allocatedWetKg: deliveredKg, deliveryCount: 1, fulfillmentStatus: "partial" });
  const balance = await findApiOrderBalance(ctx, { id });
  expect(balance).toMatchObject({ deliveredWetMassKg: 1000.1, remainingWetMassKg: 234.4 });
  expect(isStockOverdraw(balance.remainingWetMassKg, quantityKg - deliveredKg)).toBe(false);
});

it("rounds fractional grams down and subtracts the unrounded allocation", async () => {
  const quantityKg = 1234.5006;
  const deliveredKg = 1000.1001;
  mocks.order.mockResolvedValue({ id, quantityKg, archivedAt: null });
  mocks.allocation.mockResolvedValue({ allocatedWetKg: deliveredKg, deliveryCount: 1, fulfillmentStatus: "partial" });
  const balance = await findApiOrderBalance(ctx, { id });
  expect(balance).toMatchObject({ deliveredWetMassKg: 1000.1, remainingWetMassKg: 234.4 });
  const availableKg = quantityKg - deliveredKg;
  expect(isStockOverdraw(balance.remainingWetMassKg, availableKg)).toBe(false);
  expect(isStockOverdraw(234.401, availableKg)).toBe(true);
});

it("clamps an over-allocated order to zero remaining kilograms", async () => {
  mocks.allocation.mockResolvedValue({ allocatedWetKg: 101, deliveryCount: 1, fulfillmentStatus: "fulfilled" });
  expect(await findApiOrderBalance(ctx, { id })).toMatchObject({ deliveredWetMassKg: 101, remainingWetMassKg: 0 });
});

it("propagates an unknown or foreign order before querying its deliveries", async () => {
  mocks.order.mockRejectedValueOnce(new Error("not found"));
  await expect(findApiOrderBalance(ctx, { id })).rejects.toThrow("not found");
  expect(mocks.allocation).not.toHaveBeenCalled();
});
