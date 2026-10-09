import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { assertProductionRunBiocharStockNotOverdrawn } from "./production-run-stock-locks";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./bin-stock-guards", async (importOriginal) => ({
  ...await importOriginal<typeof import("./bin-stock-guards")>(),
  deriveBiocharAvailableKg: async () => -20,
}));
const ctx = { organizationId: "org", userId: "user", orgRole: "owner" as const, isPlatformAdmin: false };

it("reports output-bin overdraw with the bin and available/requested dry kilograms", async () => {
  await expect(assertProductionRunBiocharStockNotOverdrawn(ctx, {} as DbTransaction,
    [{ storageLocationId: "bin", availableKg: 80 }]))
    .rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path: ["biocharOutputKg"],
      meta: { storageLocationId: "bin", availableDryKg: 80, requestedDryKg: 100, unit: "kg" } }] });
});
