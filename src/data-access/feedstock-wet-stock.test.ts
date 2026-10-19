import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { withProductionRunErrors } from "@/lib/production-run-domain-errors";
import { allocateFeedstockWetMass, assertFeedstockWetDrawWithinStock } from "./feedstock-wet-stock";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./lane-stock-derivation", () => ({ deriveLaneStock: async () => [{ feedstockStockWetKg: 50 }] }));
const ctx = { organizationId: "org", userId: "user", orgRole: "owner" as const, isPlatformAdmin: false };
const path = ["feedstockDraws", 1, "storageLocationId"];

it("reports the available stock from the locked guard", async () => {
  await expect(withProductionRunErrors(() => assertFeedstockWetDrawWithinStock(ctx, {} as DbTransaction,
    { storageLocationId: "bin", requestedWetKg: 100, binLockAlreadyHeld: true }), path))
    .rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path,
      meta: { storageLocationId: "bin", availableWetKg: 50, requestedWetKg: 100, unit: "kg" } }] });
});

it.each([{ batches: [] }, { batches: [{ id: "intake", massWetKg: 0 }] }])("reports an empty allocation basis as insufficient stock", async ({ batches }) => {
  const tx = { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => batches }) }) }) } as unknown as DbTransaction;
  await expect(withProductionRunErrors(() => allocateFeedstockWetMass(ctx, tx, "bin", 100), path))
    .rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path,
      meta: { storageLocationId: "bin", availableWetKg: 0, requestedWetKg: 100, unit: "kg" } }] });
});
