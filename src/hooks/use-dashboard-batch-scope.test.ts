import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDashboardBatchScope } from "./use-dashboard-batch-scope";
import { dashboardOverviewKeys } from "./use-dashboard-overview";

const mocks = vi.hoisted(() => ({ read: vi.fn(), useQuery: vi.fn() }));
vi.mock("@/lib/read-api/client", () => ({ getDashboardOverviewRead: vi.fn(), getDashboardBatchScopeRead: mocks.read }));
vi.mock("@tanstack/react-query", async importOriginal => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQuery: mocks.useQuery,
}));

interface QueryOptions {
  queryKey: readonly unknown[];
  queryFn: (context: { signal: AbortSignal }) => Promise<unknown>;
  enabled: boolean;
}
function useCapturedOptions(facilityId: string | null, creditBatchId: string | null): QueryOptions {
  useDashboardBatchScope(facilityId, creditBatchId);
  return mocks.useQuery.mock.lastCall![0];
}
const signal = new AbortController().signal;
beforeEach(() => vi.clearAllMocks());

describe("useDashboardBatchScope", () => {
  it("passes the facility and nullable batch to the read API with cancellation and unwraps its result", async () => {
    const data = { batchIds: ["batch"] };
    mocks.read.mockResolvedValue({ success: true, data });
    const query = useCapturedOptions("facility", null);
    expect(query.enabled).toBe(true);
    await expect(query.queryFn({ signal })).resolves.toEqual(data);
    expect(mocks.read).toHaveBeenCalledWith({ facilityId: "facility", creditBatchId: null }, { signal });
    mocks.read.mockResolvedValue({ success: false, error: "Credit batch was not found." });
    await expect(useCapturedOptions("facility", "batch").queryFn({ signal })).rejects.toThrow("Credit batch was not found.");
  });

  it("disables reading until a facility is selected", async () => {
    const query = useCapturedOptions(null, null);
    expect(query.enabled).toBe(false);
    await expect(query.queryFn({ signal })).rejects.toThrow("No facility selected");
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
