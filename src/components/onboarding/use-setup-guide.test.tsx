import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingStatus } from "@/data-access/onboarding";
import { onboardingGuideCollapsedKey } from "./onboarding-constants";
import { onboardingKeys } from "@/hooks/use-onboarding";
import { useSetupGuide, type SetupGuideState } from "./use-setup-guide";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), sessionPending: false, userId: "user-1" }));
vi.mock("@/lib/read-api/client", () => ({ getOnboardingStatusRead: mocks.fetch }));
vi.mock("@/lib/auth/client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: mocks.userId } }, isPending: mocks.sessionPending }) },
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
let gate: SetupGuideState;

function Harness({ organizationId }: { organizationId: string | null }) {
  const current = useSetupGuide(null, organizationId);
  useEffect(() => {
    gate = current;
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
  mocks.userId = "user-1";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  client.clear();
  vi.unstubAllGlobals();
});

describe("useSetupGuide freshness", () => {
  it("waits for fresh counts before showing a cached empty-org guide", async () => {
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
    await act(async () => {
      release({ success: true, data: populatedStatus });
      await vi.waitFor(() => expect(client.isFetching()).toBe(0));
    });
    expect(gate.mode).toBe("none");
  });

  it("holds loading while the organization is unresolved", async () => {
    mocks.sessionPending = true;
    await mount(null);
    expect(gate.isLoading).toBe(true);
    expect(gate.mode).toBe("loading");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not leave a resolved session without an organization loading forever", async () => {
    await mount(null);
    expect(gate.mode).toBe("none");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("persists collapse per account and organization, including an empty organization", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    } });
    mocks.fetch.mockResolvedValue({ success: true, data: emptyStatus });
    await mount();
    await act(async () => {
      await vi.waitFor(() => expect(client.isFetching()).toBe(0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      gate.setCollapsed(true);
    });
    expect(gate.mode).toBe("strip");
    expect(storage.get(onboardingGuideCollapsedKey("user-1", "org-1"))).toBe("true");
    await act(async () => renderer.update(<QueryClientProvider client={client}><Harness organizationId="org-2" /></QueryClientProvider>));
    expect(gate.collapsed).toBe(false);
    await act(async () => renderer.update(<QueryClientProvider client={client}><Harness organizationId="org-1" /></QueryClientProvider>));
    expect(gate.collapsed).toBe(true);
    mocks.userId = "user-2";
    await act(async () => renderer.update(<QueryClientProvider client={client}><Harness organizationId="org-1" /></QueryClientProvider>));
    expect(gate.collapsed).toBe(false);
  });

  it("preserves the guide through a background refresh", async () => {
    mocks.fetch.mockResolvedValueOnce({ success: true, data: emptyStatus });
    await mount();
    await act(async () => {
      await vi.waitFor(() => expect(client.isFetching()).toBe(0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(gate.mode).toBe("takeover-guide");
    let release!: (value: unknown) => void;
    mocks.fetch.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = client.invalidateQueries({ queryKey: onboardingKeys.all });
    });
    expect(gate.mode).toBe("takeover-guide");
    expect(gate.isLoading).toBe(false);
    await act(async () => {
      release({ success: true, data: populatedStatus });
      await refresh;
    });
  });
});
