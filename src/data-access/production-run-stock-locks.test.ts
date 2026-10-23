import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { assertProductionRunBiocharStockNotOverdrawn, assertProductionRunStockSnapshot, lockProductionRunUpdateStock } from "./production-run-stock-locks";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./bin-stock-guards", async (importOriginal) => ({
  ...await importOriginal<typeof import("./bin-stock-guards")>(),
  deriveBiocharAvailableKg: async () => -20,
}));
const ctx = { organizationId: "org", userId: "user", orgRole: "admin" as const, isPlatformAdmin: false };

it("reports output-bin overdraw with the bin and available/requested dry kilograms", async () => {
  await expect(assertProductionRunBiocharStockNotOverdrawn(ctx, {} as DbTransaction,
    [{ storageLocationId: "bin", availableKg: 80 }]))
    .rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path: ["biocharOutputKg"],
      meta: { storageLocationId: "bin", availableDryKg: 80, requestedDryKg: 100, unit: "kg" } }] });
});

vi.mock("./lock-bin-stocks", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lock-bin-stocks")>(), lockBinStock: vi.fn(),
}));
import { lockBinStock } from "./lock-bin-stocks";

it("locks feedstock bins and checks discovery on a start-only edit", async () => {
  const tx = {} as DbTransaction;
  const snapshot = { feedstockStorageLocationIds: ["bin"], biocharStorageLocationId: null };
  const change = { startTime: new Date("2026-03-20T08:00:00Z") };
  await lockProductionRunUpdateStock(ctx, tx, snapshot, change);
  expect(lockBinStock).toHaveBeenCalledWith(ctx, tx, "bin", { allowArchived: true });
  expect(() => assertProductionRunStockSnapshot(snapshot,
    { ...snapshot, feedstockStorageLocationIds: ["other"] }, change)).toThrow(/Refresh and retry/);
});


it.each([
  { feedstockDraws: [{ storageLocationId: "bin" }] },
  { facilityId: "facility" },
  { status: "running" },
])("keeps active-bin checks when startTime accompanies a stock change: %j", async change => {
  vi.mocked(lockBinStock).mockClear();
  const tx = {} as DbTransaction;
  await lockProductionRunUpdateStock(ctx, tx,
    { feedstockStorageLocationIds: ["bin"], biocharStorageLocationId: null },
    { startTime: new Date("2026-03-20T08:00:00Z"), ...change });
  expect(lockBinStock).toHaveBeenCalledExactlyOnceWith(ctx, tx, "bin", { allowArchived: false });
});

it("locks all bins in sorted order and keeps biochar archive checks on a start edit", async () => {
  vi.mocked(lockBinStock).mockClear();
  const tx = {} as DbTransaction;
  await lockProductionRunUpdateStock(ctx, tx,
    { feedstockStorageLocationIds: ["z-feedstock", "z-feedstock"], biocharStorageLocationId: "a-biochar" },
    { startTime: new Date("2026-03-20T08:00:00Z") });
  expect(vi.mocked(lockBinStock).mock.calls).toEqual([
    [ctx, tx, "a-biochar", { allowArchived: false }],
    [ctx, tx, "z-feedstock", { allowArchived: true }],
  ]);
});
