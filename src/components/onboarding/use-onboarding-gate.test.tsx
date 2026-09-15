import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingStatus } from "@/data-access/onboarding";
import { onboardingKeys } from "@/hooks/use-onboarding";
import { useOnboardingGate, type OnboardingGate } from "./use-onboarding-gate";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), sessionPending: false }));
vi.mock("@/fn/onboarding", () => ({ fetchOnboardingStatus: mocks.fetch }));
vi.mock("@/lib/auth/client", () => ({
  authClient: { useSession: () => ({ data: null, isPending: mocks.sessionPending }) },
}));

const emptyStatus: OnboardingStatus = {
  isOwnerOrAdmin: true,
  isOrgOwnerOrAdmin: true,
  facilityCount: 0,
  supplierCount: 0,
  facility: null,
};
const populatedStatus = { ...emptyStatus, facilityCount: 1 };
let client: QueryClient;
let renderer: ReactTestRenderer;
let gate: OnboardingGate;
const openings = vi.fn();

function Harness({ organizationId }: { organizationId: string | null }) {
  const current = useOnboardingGate(null, organizationId);
  useEffect(() => {
    gate = current;
    // Model the Modal's onOpen callback, including its persistent latch.
    if (current.wizard.isOpen) {
      openings();
      current.wizard.latchOpen();
    }
  }, [current]);
  return null;
}

async function mount(organizationId: string | null = "org-1") {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Harness organizationId={organizationId} />
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.fetch.mockReset();
  mocks.sessionPending = false;
  openings.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

describe("useOnboardingGate freshness", () => {
  it("does not open or latch the wizard from cached zero facilities on revisit", async () => {
    mocks.fetch.mockResolvedValueOnce({ success: true, data: populatedStatus });
    await mount();
    await act(async () => {
      await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    });
    await act(async () => renderer.unmount());
    client.setQueryData(onboardingKeys.status(null, "org-1"), emptyStatus);
    let release!: (value: unknown) => void;
    mocks.fetch.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    await mount();
    expect(gate.mode).toBe("loading");
    expect(gate.isLoading).toBe(true);
    expect(gate.wizard.isOpen).toBe(false);
    expect(openings).not.toHaveBeenCalled();
    await act(async () => {
      release({ success: true, data: populatedStatus });
      await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    });
    expect(gate.mode).toBe("none");
    expect(gate.wizard.isOpen).toBe(false);
    expect(openings).not.toHaveBeenCalled();
  });

  it("holds loading while the organization is unresolved", async () => {
    mocks.sessionPending = true;
    await mount(null);
    expect(gate.isLoading).toBe(true);
    expect(gate.mode).toBe("loading");
    expect(gate.wizard.isOpen).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not leave a resolved session without an organization loading forever", async () => {
    await mount(null);
    expect(gate.mode).toBe("none");
    expect(gate.wizard.isOpen).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["explicit", "automatic"])("preserves a %s wizard through a background refresh", async (opening) => {
    mocks.fetch.mockResolvedValueOnce({
      success: true,
      data: opening === "automatic" ? emptyStatus : populatedStatus,
    });
    await mount();
    await act(async () => {
      await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    });
    // Query notifications are scheduled separately from the fetch promise.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    if (opening === "explicit") await act(async () => gate.wizard.open());
    expect(gate.wizard.isOpen).toBe(true);
    const visibleMode = gate.mode;
    let release!: (value: unknown) => void;
    mocks.fetch.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = client.invalidateQueries({ queryKey: onboardingKeys.all });
    });
    expect(client.isFetching()).toBe(1);
    expect(gate.wizard.isOpen).toBe(true);
    expect(gate.mode).toBe(visibleMode);
    expect(gate.isLoading).toBe(false);
    await act(async () => {
      release({ success: true, data: populatedStatus });
      await refresh;
    });
    expect(gate.wizard.isOpen).toBe(true);
  });
});
