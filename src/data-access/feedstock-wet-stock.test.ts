import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { withProductionRunErrors } from "@/lib/production-run-domain-errors";
import { allocateFeedstockWetMass, assertFeedstockWetDrawWithinStock } from "./feedstock-wet-stock";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./lane-stock-derivation", () => ({ deriveLaneStock: async () => [{ feedstockStockWetKg: 50 }] }));
const ctx = { organizationId: "org", userId: "user", orgRole: "admin" as const, isPlatformAdmin: false };
const path = ["feedstockDraws", 1, "storageLocationId"];

it("reports the available stock from the locked guard", async () => {
  await expect(withProductionRunErrors(() => assertFeedstockWetDrawWithinStock(ctx, {} as DbTransaction,
    { storageLocationId: "bin", requestedWetKg: 100, binLockAlreadyHeld: true }), path))
    .rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path,
      meta: { storageLocationId: "bin", availableWetKg: 50, requestedWetKg: 100, unit: "kg" } }] });
});

it.each([{ batches: [] }, { batches: [{ id: "intake", massWetKg: 0 }] }])("names the bin when the allocation basis is empty", async ({ batches }) => {
  const select = vi.fn()
    .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => batches }) }) })
    .mockReturnValueOnce({ from: () => ({ where: async () => [{ name: "North intake" }] }) });
  const tx = { select } as unknown as DbTransaction;
  await expect(withProductionRunErrors(() => allocateFeedstockWetMass(ctx, tx, "bin", 100, "2026-03-20"), path))
    .rejects.toMatchObject({ code: "insufficient_stock",
      message: "Bin North intake has no complete intake with wet mass delivered by the run’s start day. Move the run’s start or correct the intake’s delivery date.",
      issues: [{ path,
      meta: { storageLocationId: "bin", availableWetKg: 0, requestedWetKg: 100, unit: "kg" } }] });
});

it.each([
  { rows: [] }, { rows: [{ name: null }] }, { rows: [{ name: "" }] }, { rows: [{ name: "   " }] },
])("falls back when the bin name is unavailable: %j", async ({ rows }) => {
  const select = vi.fn()
    .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) })
    .mockReturnValueOnce({ from: () => ({ where: async () => rows }) });
  await expect(allocateFeedstockWetMass(ctx, { select } as unknown as DbTransaction, "bin", 100, "2026-03-20"))
    .rejects.toMatchObject({
      message: "This bin has no complete intake with wet mass delivered by the run’s start day. Move the run’s start or correct the intake’s delivery date.",
    });
});

it("refuses a draw above the qualifying intake total with stock metadata", async () => {
  const batches = [{ id: "first", massWetKg: 10_000 }, { id: "second", massWetKg: 10_000 }];
  const select = vi.fn()
    .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => batches }) }) })
    .mockReturnValueOnce({ from: () => ({ where: async () => [{ name: "North intake" }] }) });
  const tx = { select } as unknown as DbTransaction;
  await expect(withProductionRunErrors(() => allocateFeedstockWetMass(ctx, tx, "bin", 25_000, "2026-03-20"), path))
    .rejects.toMatchObject({ code: "insufficient_stock",
      message: "By the run’s start day bin North intake had received 20,000 kg, less than the 25,000 kg drawn. Lower the draw or move the run’s start.",
      issues: [{ path, meta: { storageLocationId: "bin", availableWetKg: 20_000, requestedWetKg: 25_000, unit: "kg" } }],
    });
});

it.each([
  { rows: [] }, { rows: [{ name: null }] }, { rows: [{ name: "" }] }, { rows: [{ name: "   " }] },
])("falls back when an overdrawn bin name is unavailable: %j", async ({ rows }) => {
  const batches = [{ id: "intake", massWetKg: 50 }];
  const select = vi.fn()
    .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => batches }) }) })
    .mockReturnValueOnce({ from: () => ({ where: async () => rows }) });
  await expect(allocateFeedstockWetMass(ctx, { select } as unknown as DbTransaction, "bin", 100, "2026-03-20"))
    .rejects.toMatchObject({
      message: "By the run’s start day this bin had received 50 kg, less than the 100 kg drawn. Lower the draw or move the run’s start.",
    });
});

it("allocates exactly the qualifying total without exceeding either intake", async () => {
  const batches = [{ id: "first", massWetKg: 10_000 }, { id: "second", massWetKg: 10_000 }];
  const tx = { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => batches }) }) }) } as unknown as DbTransaction;
  await expect(allocateFeedstockWetMass(ctx, tx, "bin", 20_000, "2026-03-20"))
    .resolves.toEqual(batches.map(batch => ({ feedstockId: batch.id, wetMassUsedKg: batch.massWetKg })));
});
