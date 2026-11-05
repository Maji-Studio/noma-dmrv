import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), take: vi.fn(), loss: vi.fn(), correct: vi.fn(), read: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: mocks.auth }));
vi.mock("@/data-access/bin-movements", () => ({
  recordStockTakeMovement: mocks.take, createBinMovement: mocks.loss, StockTakeIncreaseError: class extends Error {},
}));
vi.mock("@/data-access/feedstock-loss-corrections", () => ({ correctFeedstockLoss: mocks.correct }));
vi.mock("@/data-access/feedstock-bin-ledger", () => ({ getFeedstockBinStock: mocks.read }));
import { recordStockTakeFn, recordLossFn, removeLossFn, getFeedstockBinStockFn } from "./bin-movements";

const BIN = "11111111-1111-4111-8111-111111111111";
const ctx = { organizationId: "org", userId: "user", orgRole: "admin", isPlatformAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(ctx);
  vi.stubEnv("STOCK_ADJUSTMENTS_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());

it("refuses feedstock counts, losses, loss corrections and deletion while off", async () => {
  const common = { storageLocationId: BIN, lane: "feedstock" as const, reason: "Wrong reading" };
  const loss = { ...common, occurredAt: "2026-09-14T12:00:00.000Z", lossMassKg: 1, idempotencyKey: "key" };
  const expected = { success: false, code: "conflict", error: "Lost mass and stock counts are turned off on this server." };
  expect(await recordStockTakeFn({ ...common, countedMassKg: 1, countedWetMassKg: 1, moistureRatioUsed: 0.2 })).toEqual(expected);
  expect(await recordLossFn(loss)).toEqual(expected);
  expect(await recordLossFn({ ...loss, correctsMovementId: BIN })).toEqual(expected);
  expect(await removeLossFn({ ...common, correctsMovementId: BIN, idempotencyKey: "key" })).toEqual(expected);
  expect(mocks.take).not.toHaveBeenCalled();
  expect(mocks.loss).not.toHaveBeenCalled();
  expect(mocks.correct).not.toHaveBeenCalled();
});

it("keeps stock reads open and still resolves authentication", async () => {
  mocks.read.mockResolvedValue({ movements: [] });
  expect(await getFeedstockBinStockFn(BIN)).toEqual({ success: true, data: { movements: [] } });
  expect(mocks.read).toHaveBeenCalledWith(ctx, BIN);
  expect(mocks.auth).toHaveBeenCalledOnce();
});
