import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ useInfiniteQuery: vi.fn(), useQuery: vi.fn(), summary: vi.fn(), read: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useInfiniteQuery: mocks.useInfiniteQuery, useQuery: mocks.useQuery }));
vi.mock("@/lib/read-api/client", () => ({ getCreditBatchActivityRead: mocks.read, getCreditBatchActivitySummaryRead: mocks.summary }));
import { useCreditBatchActivity, useCreditBatchActivitySummary, activityKeys } from "./use-credit-batch-activity";

it("fetches cursor pages with cancellation and keeps the activity query fresh", async () => {
  useCreditBatchActivity("batch", { limit: 5 });
  const [options] = mocks.useInfiniteQuery.mock.calls.at(-1)!;
  expect(options.queryKey).toEqual(activityKeys.creditBatch("batch", 5));
  expect(options.staleTime).toBe(0);
  expect(options.initialPageParam).toBeUndefined();
  expect(options.getNextPageParam({ nextCursor: "next" })).toBe("next");
  expect(options.getNextPageParam({ nextCursor: null })).toBeUndefined();
  const signal = new AbortController().signal;
  mocks.read.mockResolvedValue({ success: true, data: { items: [], nextCursor: null } });
  await expect(options.queryFn({ pageParam: "cursor", signal })).resolves.toEqual({ items: [], nextCursor: null });
  expect(mocks.read).toHaveBeenCalledWith({ creditBatchId: "batch", limit: 5, cursor: "cursor" }, { signal });
});
it("keys and requests filtered pages separately from the unfiltered list", async () => {
  useCreditBatchActivity("batch", { limit: 5, filters: { action: "deleted", entityType: "lab_sample" } });
  const [options] = mocks.useInfiniteQuery.mock.calls.at(-1)!;
  expect(options.queryKey).toEqual(activityKeys.creditBatch("batch", 5, { action: "deleted", entityType: "lab_sample" }));
  expect(options.queryKey).not.toEqual(activityKeys.creditBatch("batch", 5));
  expect(options.queryKey.slice(0, 1)).toEqual(activityKeys.all);
  mocks.read.mockResolvedValue({ success: true, data: { items: [], nextCursor: null } });
  await options.queryFn({ pageParam: undefined, signal: undefined });
  expect(mocks.read).toHaveBeenLastCalledWith(
    { creditBatchId: "batch", limit: 5, cursor: undefined, action: "deleted", entityType: "lab_sample" }, { signal: undefined },
  );
});
it("disables the query without a batch", () => {
  useCreditBatchActivity("");
  expect(mocks.useInfiniteQuery.mock.calls.at(-1)![0].enabled).toBe(false);
});

it("fetches a fresh summary with cancellation under the activity key root", async () => {
  useCreditBatchActivitySummary("batch");
  const [options] = mocks.useQuery.mock.calls.at(-1)!;
  expect(options.queryKey).toEqual([...activityKeys.all, "credit-batch-summary", "batch"]);
  expect(options.staleTime).toBe(0);
  expect(options.enabled).toBe(true);
  const signal = new AbortController().signal;
  const summary = { total: 0, counts: [], latest: null };
  mocks.summary.mockResolvedValue({ success: true, data: summary });
  await expect(options.queryFn({ signal })).resolves.toEqual(summary);
  expect(mocks.summary).toHaveBeenCalledWith({ creditBatchId: "batch" }, { signal });
  useCreditBatchActivitySummary("");
  expect(mocks.useQuery.mock.calls.at(-1)![0].enabled).toBe(false);
});
