import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { withProductionRunErrors } from "@/lib/production-run-domain-errors";
import { replayFeedstockBinStock } from "./feedstock-bin-ledger";
import { allocateFeedstockWetMass, assertFeedstockWetDrawWithinStock } from "./feedstock-wet-stock";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./feedstock-bin-ledger", () => ({ replayFeedstockBinStock: vi.fn() }));
vi.mock("./feedstock-bin-method-history", () => ({ getFeedstockMethodChanges: async () => [] }));
vi.mock("./output-stock-dates", () => ({ getOutputStockFacilityTimezone: async () => "UTC" }));
function reader(batches: { id: string; massWetKg: number }[], code: string | null = "SL-26-001") {
  vi.mocked(replayFeedstockBinStock).mockResolvedValue({ currentWetKg: batches.reduce((sum, row) => sum + row.massWetKg, 0), batches: [], withdrawals: new Map(), remainingDryKg: null,
    entries: batches.map(row => ({ id: row.id, sourceId: row.id, code: row.id, kind: "intake", occurredAt: "2026-03-01T00:00:00.000Z",
      recordedAt: "2026-03-01T00:00:00.000Z", wetDeltaKg: row.massWetKg, actorName: null, reason: "", countedWetKg: null, moisturePercent: null,
      beforeWetKg: 0, afterWetKg: row.massWetKg, estimatedDryKg: null })),
  });
  return { select: () => ({ from: () => ({ where: async () => [{ code: code ?? undefined, facilityId: "facility", stockMode: "split", drawOrder: "oldest_first" }] }) }) } as unknown as DbTransaction;
}
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
  const tx = reader(batches);
  await expect(withProductionRunErrors(() => allocateFeedstockWetMass(ctx, tx, "bin", 100, "2026-03-20"), path))
    .rejects.toMatchObject({ code: "insufficient_stock",
      message: "Bin SL-26-001 held no wet feedstock at the run’s start. Move the run’s start or correct the intake’s delivery date.",
      issues: [{ path,
      meta: { storageLocationId: "bin", availableWetKg: 0, requestedWetKg: 100, unit: "kg" } }] });
});

it("falls back when the bin row is unavailable", async () => {
  await expect(allocateFeedstockWetMass(ctx, reader([], null), "bin", 100, "2026-03-20"))
    .rejects.toMatchObject({
      message: "This bin held no wet feedstock at the run’s start. Move the run’s start or correct the intake’s delivery date.",
    });
});

it("refuses a draw above the qualifying intake total with stock metadata", async () => {
  const batches = [{ id: "first", massWetKg: 10_000 }, { id: "second", massWetKg: 10_000 }];
  const tx = reader(batches);
  await expect(withProductionRunErrors(() => allocateFeedstockWetMass(ctx, tx, "bin", 25_000, "2026-03-20"), path))
    .rejects.toMatchObject({ code: "insufficient_stock",
      message: "By the run’s start day bin SL-26-001 held 20,000 kg, less than the 25,000 kg drawn. Lower the draw or move the run’s start.",
      issues: [{ path, meta: { storageLocationId: "bin", availableWetKg: 20_000, requestedWetKg: 25_000, unit: "kg" } }],
    });
});

it("falls back when an overdrawn bin row is unavailable", async () => {
  const batches = [{ id: "intake", massWetKg: 50 }];
  await expect(allocateFeedstockWetMass(ctx, reader(batches, null), "bin", 100, "2026-03-20"))
    .rejects.toMatchObject({
      message: "By the run’s start day this bin held 50 kg, less than the 100 kg drawn. Lower the draw or move the run’s start.",
    });
});

it("allocates exactly the qualifying total without exceeding either intake", async () => {
  const batches = [{ id: "first", massWetKg: 10_000 }, { id: "second", massWetKg: 10_000 }];
  const tx = reader(batches);
  await expect(allocateFeedstockWetMass(ctx, tx, "bin", 20_000, "2026-03-20"))
    .resolves.toEqual(batches.map(batch => ({ feedstockId: batch.id, wetMassUsedKg: batch.massWetKg })));
});
