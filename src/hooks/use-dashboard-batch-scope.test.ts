import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDashboardBatchScope } from "./use-dashboard-batch-scope";
import { dashboardOverviewKeys } from "./use-dashboard-overview";

const mocks = vi.hoisted(() => ({ read: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/fn/dashboard-batch-scope", () => ({ getDashboardBatchScopeFn: mocks.read }));
vi.mock("@/lib/read-api/client", () => ({ getDashboardOverviewRead: vi.fn() }));
vi.mock("@tanstack/react-query", async importOriginal => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQuery: mocks.useQuery,
}));

interface QueryOptions {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
  enabled: boolean;
}
function useCapturedOptions(facilityId: string | null, creditBatchId: string | null): QueryOptions {
  useDashboardBatchScope(facilityId, creditBatchId);
  return mocks.useQuery.mock.lastCall![0];
}
beforeEach(() => vi.clearAllMocks());

describe("useDashboardBatchScope", () => {
  it("passes the facility and nullable batch to the action and unwraps its result", async () => {
    const data = { batchIds: ["batch"] };
    mocks.read.mockResolvedValue({ success: true, data });
    const query = useCapturedOptions("facility", null);
    expect(query.enabled).toBe(true);
    await expect(query.queryFn()).resolves.toEqual(data);
    expect(mocks.read).toHaveBeenCalledWith({ facilityId: "facility", creditBatchId: null });
    mocks.read.mockResolvedValue({ success: false, error: "Credit batch not found" });
    await expect(useCapturedOptions("facility", "batch").queryFn()).rejects.toThrow("Credit batch not found");
  });

  it("disables reading until a facility is selected", async () => {
    const query = useCapturedOptions(null, null);
    expect(query.enabled).toBe(false);
    await expect(query.queryFn()).rejects.toThrow("No facility selected");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("separates facilities and single/all scopes without renaming overview keys", () => {
    const keys = [useCapturedOptions("one", null).queryKey, useCapturedOptions("two", null).queryKey, useCapturedOptions("one", "batch").queryKey];
    expect(new Set(keys.map(key => JSON.stringify(key))).size).toBe(keys.length);
    expect(dashboardOverviewKeys.overview("one", "all")).toEqual(["dashboard-overview", "one", "all"]);
  });

  it("refreshes single and all scopes under the existing dashboard invalidation prefix", async () => {
    const client = new QueryClient();
    const keys = [dashboardOverviewKeys.overview("facility", "all"), useCapturedOptions("facility", null).queryKey, useCapturedOptions("facility", "batch").queryKey];
    try {
      for (const key of keys) client.setQueryData(key, {});
      client.setQueryData(["unrelated"], {});
      await client.invalidateQueries({ queryKey: dashboardOverviewKeys.all });
      for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(client.getQueryState(["unrelated"])?.isInvalidated).toBe(false);
    } finally {
      client.clear();
    }
  });
});
