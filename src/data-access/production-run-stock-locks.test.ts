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
  ...await importOriginal<typeof import("./lock-bin-stocks")>(), lockBinStocks: vi.fn(),
}));
import { lockBinStocks } from "./lock-bin-stocks";

it("locks feedstock bins and checks discovery on a start-only edit", async () => {
  const tx = {} as DbTransaction;
  const snapshot = { feedstockStorageLocationIds: ["bin"], biocharStorageLocationId: null };
  const change = { startTime: new Date("2026-03-20T08:00:00Z") };
  await lockProductionRunUpdateStock(ctx, tx, snapshot, change);
  expect(lockBinStocks).toHaveBeenCalledWith(ctx, tx, ["bin", "bin", null, null]);
  expect(() => assertProductionRunStockSnapshot(snapshot,
    { ...snapshot, feedstockStorageLocationIds: ["other"] }, change)).toThrow(/Refresh and retry/);
});
