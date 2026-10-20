// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), empties: vi.fn() }));
vi.mock("@/fn/certification", () => ({ loadRemovalCertifyContext: mocks.context }));
vi.mock("@/fn/certification/emission-zeros", () => ({
  getRemovalEmptyLinesFn: mocks.empties,
  recordEmissionZerosFn: vi.fn(),
  undoEmissionZerosFn: vi.fn(),
}));

import { useRemovalLanding } from "./use-removal-empty-components";

const OPEN = { removalVersion: 1, editable: true, batches: [{ creditBatchId: "b", code: "CB-1", lines: [{ componentId: "a" }], zeros: [] }] };
const CONFIRMED = { removalVersion: 2, editable: true, batches: [{ creditBatchId: "b", code: "CB-1", lines: [], zeros: [{ id: "z", componentId: "a" }] }] };

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.context.mockReset().mockResolvedValue({ success: true, data: { emissionsEntriesEnabled: true } });
  mocks.empties.mockReset();
});

describe("useRemovalLanding", () => {
  it("resolves once per opening: closing and reopening the dialog reads the Removal again", async () => {
    const client = new QueryClient();
    mocks.empties.mockResolvedValue({ success: true, data: OPEN });
    const first = renderHook(() => useRemovalLanding("removal-1", "facility-1", true), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.data?.step).toBe("empty"));

    // Zeros are confirmed elsewhere, then the dialog closes (unmounts) and opens again.
    mocks.empties.mockResolvedValue({ success: true, data: CONFIRMED });
    first.unmount();
    // The unused query is collected on the next tick, long before a person reopens the dialog.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = renderHook(() => useRemovalLanding("removal-1", "facility-1", true), { wrapper: wrapper(client) });
    await waitFor(() => expect(second.result.current.data?.step).toBe("submit"));
    expect(mocks.empties).toHaveBeenCalledTimes(2);
  });

  it("does not read the empty components when entries are switched off", async () => {
    const client = new QueryClient();
    mocks.context.mockResolvedValue({ success: true, data: { emissionsEntriesEnabled: false } });
    const view = renderHook(() => useRemovalLanding("removal-1", "facility-1", true), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.data).toEqual({ entriesEnabled: false, step: "submit" }));
    expect(mocks.empties).not.toHaveBeenCalled();
  });

  it("keeps the landing while the dialog stays open, even when the data later changes", async () => {
    const client = new QueryClient();
    mocks.empties.mockResolvedValue({ success: true, data: OPEN });
    const view = renderHook(() => useRemovalLanding("removal-1", "facility-1", true), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.data?.step).toBe("empty"));
    mocks.empties.mockResolvedValue({ success: true, data: CONFIRMED });
    view.rerender();
    await client.invalidateQueries();
    expect(view.result.current.data?.step).toBe("empty");
  });
});
