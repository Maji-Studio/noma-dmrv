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

it.each([{ batches: [] }, { batches: [{ id: "intake", massWetKg: 0 }] }])("reports an empty allocation basis as insufficient stock", async ({ batches }) => {
  const tx = { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => batches }) }) }) } as unknown as DbTransaction;
  await expect(withProductionRunErrors(() => allocateFeedstockWetMass(ctx, tx, "bin", 100, "2026-03-20"), path))
    .rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path,
      meta: { storageLocationId: "bin", availableWetKg: 0, requestedWetKg: 100, unit: "kg" } }] });
});

it("refuses a draw above the qualifying intake total with stock metadata", async () => {
  const batches = [{ id: "first", massWetKg: 10_000 }, { id: "second", massWetKg: 10_000 }];
  const tx = { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => batches }) }) }) } as unknown as DbTransaction;
  await expect(withProductionRunErrors(() => allocateFeedstockWetMass(ctx, tx, "bin", 25_000, "2026-03-20"), path))
    .rejects.toMatchObject({ code: "insufficient_stock",
      message: "By the run's start day this bin had received 20,000 kg, less than the 25,000 kg drawn. Lower the draw or move the run's start.",
      issues: [{ path, meta: { storageLocationId: "bin", availableWetKg: 20_000, requestedWetKg: 25_000, unit: "kg" } }],
    });
});

it("allocates exactly the qualifying total without exceeding either intake", async () => {
  const batches = [{ id: "first", massWetKg: 10_000 }, { id: "second", massWetKg: 10_000 }];
  const tx = { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => batches }) }) }) } as unknown as DbTransaction;
  await expect(allocateFeedstockWetMass(ctx, tx, "bin", 20_000, "2026-03-20"))
    .resolves.toEqual(batches.map(batch => ({ feedstockId: batch.id, wetMassUsedKg: batch.massWetKg })));
});
