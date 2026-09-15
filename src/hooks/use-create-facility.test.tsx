import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { facilityKeys, useCreateFacility } from "./use-facilities";
import { onboardingKeys } from "./use-onboarding";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/fn/facilities", () => ({ createFacilityFn: mocks.create }));
vi.mock("@/fn/onboarding", () => ({ fetchOnboardingStatus: vi.fn() }));

it("keeps facility creation pending for the active list but not country or onboarding refreshes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const row = { id: "facility-1", code: "FAC-001" };
  mocks.create.mockResolvedValueOnce({ success: true, data: row });
  const oldList = { items: [], total: 0 };
  const newList = { items: [{ ...row, reactorCount: 0 }], total: 1 };
  const listKey = facilityKeys.list();
  client.setQueryData(listKey, oldList);
  let releaseList!: () => void;
  let releaseBackground!: () => void;
  const listHeld = new Promise<void>((resolve) => { releaseList = resolve; });
  const backgroundHeld = new Promise<void>((resolve) => { releaseBackground = resolve; });
  const listObserver = new QueryObserver(client, {
    queryKey: listKey, staleTime: Infinity,
    queryFn: async () => { await listHeld; return newList; },
  });
  const unsubscribeList = listObserver.subscribe(() => undefined);
  const backgroundObservers = [onboardingKeys.status(null, "org-1"), facilityKeys.countries(false)].map((queryKey) => {
    client.setQueryData(queryKey, []);
    const observer = new QueryObserver(client, {
      queryKey, staleTime: Infinity,
      queryFn: async () => { await backgroundHeld; return []; },
    });
    return { observer, unsubscribe: observer.subscribe(() => undefined) };
  });
  let mutation!: ReturnType<typeof useCreateFacility>;
  function Harness() {
    const current = useCreateFacility();
    useEffect(() => { mutation = current; }, [current]);
    return null;
  }
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => {
      renderer = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
    });
    let save!: ReturnType<typeof mutation.mutateAsync>;
    let settled = false;
    await act(async () => {
      save = mutation.mutateAsync({ name: "E2E Facility", country: "CH", durabilityOption: "200_year", timezone: "UTC" });
      void save.then(() => { settled = true; });
      await vi.waitFor(() => expect(listObserver.getCurrentResult().isFetching).toBe(true));
    });
    expect(mutation.isPending).toBe(true);
    expect(settled).toBe(false);
    expect(client.getQueryData(listKey)).toEqual(oldList);
    expect(client.getQueryData(facilityKeys.detail(row.id))).toEqual(row);
    await act(async () => {
      releaseList();
      await expect(save).resolves.toEqual(row);
    });
    expect(settled).toBe(true);
    expect(client.getMutationCache().getAll()[0].state.status).toBe("success");
    expect(client.getQueryData(listKey)).toEqual(newList);
    for (const { observer } of backgroundObservers) {
      expect(observer.getCurrentResult().isFetching).toBe(true);
    }
  } finally {
    releaseList();
    releaseBackground();
    unsubscribeList();
    backgroundObservers.forEach(({ unsubscribe }) => unsubscribe());
    await act(async () => renderer?.unmount());
    client.clear();
    vi.unstubAllGlobals();
  }
});
