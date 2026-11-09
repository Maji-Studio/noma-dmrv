import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgContext } from "@/lib/auth/server";
import type { CreditBatchLineageFacts } from "./credit-batch-lineage-types";
import { getDashboardBatchScope } from "./dashboard-batch-scope";

const mocks = vi.hoisted(() => ({
  select: vi.fn(), accounting: vi.fn(), activity: vi.fn(), requireOrgScope: vi.fn(),
}));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("./credit-batch-accounting", () => ({ loadCreditBatchAccounting: mocks.accounting }));
vi.mock("./dashboard-stations", () => ({ getDashboardScopedActivity: mocks.activity }));
vi.mock("./utils", () => ({ requireOrgScope: mocks.requireOrgScope }));

const ctx: OrgContext = { organizationId: "org", userId: "user", orgRole: "admin", isPlatformAdmin: false };
const FACILITY_ID = "facility";
const BATCH_A = "batch-a";
const BATCH_B = "batch-b";
const ACTIVITY = [{ id: "event", code: "CB-A", title: "Credit batch created", dateIso: "2026-01-01T00:00:00.000Z", href: `/credit-batches/${BATCH_A}` }];
const facts = (batchId: string): CreditBatchLineageFacts => ({
  batchId, productionRunIds: [], applicationIds: [], runs: [], applications: [], appliedWeightTons: 0,
});
const rollup = (batchId: string, facilityId = FACILITY_ID) => ({
  batch: { facilityId }, lineageFacts: facts(batchId), co2ePreview: { co2eStoredTonnes: null },
});
function selectBatches(batches = [
  { id: BATCH_A, claimedByRemovalId: null },
  { id: BATCH_B, claimedByRemovalId: "stale-removal" },
]) {
  mocks.select.mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => batches }) }) });
  mocks.select.mockReturnValue({ from: () => ({ where: async () => [] }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.activity.mockResolvedValue(ACTIVITY);
});

describe("getDashboardBatchScope concurrent changes", () => {
  it.each(["deleted", "moved"])("skips a batch %s during the all-batches read, including its Removal ids", async (change) => {
    selectBatches();
    mocks.accounting.mockResolvedValue({
      [BATCH_A]: rollup(BATCH_A),
      ...(change === "moved" ? { [BATCH_B]: rollup(BATCH_B, "other-facility") } : {}),
    });
    const scope = await getDashboardBatchScope(ctx, FACILITY_ID, null);
    expect(scope.batchIds).toEqual([BATCH_A]);
    expect(scope.recordIds).toEqual([BATCH_A]);
    expect(scope.activity).toEqual(ACTIVITY);
    expect(mocks.accounting).toHaveBeenCalledExactlyOnceWith(ctx, [BATCH_A, BATCH_B], { includeRunForwards: true });
    expect(mocks.activity).toHaveBeenCalledExactlyOnceWith(ctx, FACILITY_ID, [BATCH_A]);
    expect(mocks.requireOrgScope).toHaveBeenCalledWith(ctx);
  });

  it.each(["deleted", "moved"])("refuses a specifically selected batch %s during accounting", async (change) => {
    selectBatches([{ id: BATCH_B, claimedByRemovalId: "stale-removal" }]);
    mocks.accounting.mockResolvedValue(change === "deleted" ? {} : { [BATCH_B]: rollup(BATCH_B, "other-facility") });
    await expect(getDashboardBatchScope(ctx, FACILITY_ID, BATCH_B)).rejects.toThrow("Credit batch was not found.");
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("refuses a selected batch missing from the initial selection", async () => {
    selectBatches([]);
    await expect(getDashboardBatchScope(ctx, FACILITY_ID, BATCH_B)).rejects.toThrow("Credit batch was not found.");
    expect(mocks.accounting).not.toHaveBeenCalled();
  });

  it("returns empty scope when every batch disappears mid-read", async () => {
    selectBatches();
    mocks.accounting.mockResolvedValue({});
    mocks.activity.mockResolvedValue([]);
    const scope = await getDashboardBatchScope(ctx, FACILITY_ID, null);
    expect(scope.batchIds).toEqual([]);
    expect(scope.recordIds).toEqual([]);
    expect(scope.activity).toEqual([]);
    // Only the initial batch selection; no Removal query for vanished batches.
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });
});

describe("getDashboardBatchScope run forwards", () => {
  it("reads all credit batches without run forwards when that walk fails closed", async () => {
    selectBatches();
    mocks.accounting
      .mockRejectedValueOnce(new Error("delivery allocations are inconsistent"))
      .mockResolvedValueOnce({ [BATCH_A]: rollup(BATCH_A), [BATCH_B]: rollup(BATCH_B) });
    const scope = await getDashboardBatchScope(ctx, FACILITY_ID, null);
    expect(scope.batchIds).toEqual([BATCH_A, BATCH_B]);
    expect(mocks.accounting).toHaveBeenNthCalledWith(1, ctx, [BATCH_A, BATCH_B], { includeRunForwards: true });
    expect(mocks.accounting).toHaveBeenNthCalledWith(2, ctx, [BATCH_A, BATCH_B]);
  });

  it("lets one selected batch fail closed, so its own error shows", async () => {
    selectBatches([{ id: BATCH_A, claimedByRemovalId: null }]);
    mocks.accounting.mockRejectedValueOnce(new Error("delivery allocations are inconsistent"));
    await expect(getDashboardBatchScope(ctx, FACILITY_ID, BATCH_A)).rejects.toThrow("delivery allocations are inconsistent");
    expect(mocks.accounting).toHaveBeenCalledTimes(1);
  });
});
