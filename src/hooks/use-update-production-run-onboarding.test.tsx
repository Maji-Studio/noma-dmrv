import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { productionRunKeys, useUpdateProductionRun } from "./use-production-runs";
import { onboardingKeys } from "./use-onboarding";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/fn/production-runs", () => ({ updateProductionRunFn: mocks.update }));
vi.mock("@/lib/read-api/client", () => ({ getOnboardingStatusRead: vi.fn() }));
vi.mock("./use-certification", () => ({ invalidateCertificationReadiness: vi.fn() }));

it.each([
  { previous: "facility-a", affected: ["facility-a", "facility-b"] },
  { previous: "facility-b", affected: ["facility-b"] },
  { previous: null, affected: ["facility-a", "facility-b", "facility-c"] },
])("invalidates affected onboarding scopes when updating from $previous", async ({ previous, affected }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const row = { id: "run-1", facilityId: "facility-b", status: "complete" };
  mocks.update.mockResolvedValueOnce({ success: true, data: row });
  if (previous) client.setQueryData(productionRunKeys.detail(row.id), { ...row, facilityId: previous });
  const facilities = ["facility-a", "facility-b", "facility-c"];
  for (const facility of facilities) client.setQueryData(onboardingKeys.status(facility, "org-1"), { completeProductionRunCount: 1 });
  let mutation!: ReturnType<typeof useUpdateProductionRun>;
  function Harness() {
    const current = useUpdateProductionRun();
    useEffect(() => { mutation = current; }, [current]);
    return null;
  }
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
    await act(async () => { await mutation.mutateAsync({ productionRunId: row.id, facilityId: row.facilityId }); });
    for (const facility of facilities) expect(client.getQueryState(onboardingKeys.status(facility, "org-1"))?.isInvalidated).toBe(affected.includes(facility));
    expect(client.getQueryData(productionRunKeys.detail(row.id))).toEqual(row);
  } finally {
    await act(async () => renderer?.unmount());
    client.clear();
    vi.unstubAllGlobals();
  }
});
