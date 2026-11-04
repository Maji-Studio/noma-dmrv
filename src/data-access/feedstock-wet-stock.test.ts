import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { withProductionRunErrors } from "@/lib/production-run-domain-errors";
import { assertFeedstockWetDrawWithinStock } from "./feedstock-wet-stock";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./feedstock-bin-ledger", () => ({ replayFeedstockBinStock: vi.fn() }));
vi.mock("./feedstock-bin-method-history", () => ({ getFeedstockMethodChanges: async () => [] }));
vi.mock("./output-stock-dates", () => ({ getOutputStockFacilityTimezone: async () => "UTC" }));
vi.mock("./lane-stock-derivation", () => ({ deriveLaneStock: async () => [{ feedstockStockWetKg: 50 }] }));
const ctx = { organizationId: "org", userId: "user", orgRole: "admin" as const, isPlatformAdmin: false };
const path = ["feedstockDraws", 1, "storageLocationId"];

it("reports the available stock from the locked guard", async () => {
  await expect(withProductionRunErrors(() => assertFeedstockWetDrawWithinStock(ctx, {} as DbTransaction,
    { storageLocationId: "bin", requestedWetKg: 100, binLockAlreadyHeld: true }), path))
    .rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path,
      meta: { storageLocationId: "bin", availableWetKg: 50, requestedWetKg: 100, unit: "kg" } }] });
});
