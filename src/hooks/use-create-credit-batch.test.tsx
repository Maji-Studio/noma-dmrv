import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditBatchFormData } from "@/schemas/credit-batches";
import { creditBatchKeys, useCreateCreditBatch } from "./use-credit-batches";
import { onboardingKeys } from "./use-onboarding";

const mocks = vi.hoisted(() => ({ create: vi.fn(), readiness: vi.fn() }));
vi.mock("@/fn/credit-batches", () => ({ createCreditBatchFn: mocks.create }));
vi.mock("@/fn/onboarding", () => ({ fetchOnboardingStatus: vi.fn() }));
vi.mock("./use-certification", () => ({ invalidateCertificationReadiness: mocks.readiness }));

const row = { id: "batch-1", facilityId: "facility-1", code: "CB-001" };
const input = { facilityId: row.facilityId } as CreditBatchFormData;
let client: QueryClient;
let renderer: ReactTestRenderer;
let mutation: ReturnType<typeof useCreateCreditBatch>;
function Harness() {
  const current = useCreateCreditBatch();
  useEffect(() => { mutation = current; }, [current]);
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    renderer = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

describe("useCreateCreditBatch", () => {
  it("rejects action failures and preserves mutation error state without cache writes or invalidation", async () => {
    mocks.create.mockResolvedValueOnce({ success: false, error: "Credit batch was not created." });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const setData = vi.spyOn(client, "setQueryData");
    await act(async () => {
      await expect(mutation.mutateAsync(input)).rejects.toThrow("Credit batch was not created.");
      await vi.waitFor(() => expect(client.getMutationCache().getAll()[0].state.status).toBe("error"));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(mutation.isError).toBe(true);
    expect(mutation.error?.message).toBe("Credit batch was not created.");
    expect(setData).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it("returns the created row and seeds authoritative detail while onboarding refresh remains pending", async () => {
    mocks.create.mockResolvedValueOnce({ success: true, data: row });
    const key = onboardingKeys.status(row.facilityId, "org-1");
    client.setQueryData(key, { creditBatchCount: 0 });
    const listKey = creditBatchKeys.list({ facilityId: row.facilityId });
    client.setQueryData(listKey, []);
    let releaseList!: () => void;
    const listHeld = new Promise<void>((resolve) => { releaseList = resolve; });
    const listObserver = new QueryObserver(client, {
      queryKey: listKey, staleTime: Infinity,
      queryFn: async () => { await listHeld; return [row]; },
    });
    const unsubscribeList = listObserver.subscribe(() => undefined);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const observer = new QueryObserver(client, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => { await held; return { creditBatchCount: 1 }; },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    let save!: ReturnType<typeof mutation.mutateAsync>;
    await act(async () => {
      save = mutation.mutateAsync(input);
      await vi.waitFor(() => expect(listObserver.getCurrentResult().isFetching).toBe(true));
    });
    expect(client.getMutationCache().getAll()[0].state.status).toBe("pending");
    expect(client.getQueryData(listKey)).toEqual([]);
    await act(async () => {
      releaseList();
      // The mutation answers with the committed batch and whether its
      // accounting roll-up loaded with it (issue #769).
      await expect(save).resolves.toEqual({ creditBatch: row, warning: undefined });
    });
    expect(client.getQueryData(creditBatchKeys.detail(row.id))).toEqual(row);
    expect(client.getQueryData(listKey)).toEqual([row]);
    expect(mocks.readiness).toHaveBeenCalledWith(client);
    expect(observer.getCurrentResult().isFetching).toBe(true);
    expect(client.getMutationCache().getAll()[0].state.status).toBe("success");
    release();
    await vi.waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(false));
    unsubscribe();
    unsubscribeList();
  });
});
