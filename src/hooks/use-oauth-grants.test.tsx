import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { oauthGrantKeys, useOAuthGrants, useRevokeOAuthGrant } from "./use-oauth-grants";
import { STALE_VERSION_MESSAGE, StaleVersionError } from "@/lib/stale-version";

const actions = vi.hoisted(() => ({ list: vi.fn(), revoke: vi.fn() }));
vi.mock("@/fn/oauth", () => ({ listOAuthGrantsFn: actions.list, revokeOAuthGrantFn: actions.revoke }));
let client: QueryClient;
let tree: ReactTestRenderer;
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { if (tree) await act(async () => tree.unmount()); client.clear(); });
it("caches connected apps under the active organization", async () => {
  actions.list.mockResolvedValue({ success: true, data: [{ id: "grant" }] });
  function Harness() { useOAuthGrants("org"); return null; }
  await act(async () => { tree = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
  await vi.waitFor(() => expect(client.getQueryData(oauthGrantKeys.list("org"))).toEqual([{ id: "grant" }]));
  expect(client.getQueryData(oauthGrantKeys.list("other"))).toBeUndefined();
});
it.each([false, true])("refreshes connected apps after disconnect or a stale conflict (stale=%s)", async stale => {
  actions.revoke.mockResolvedValue(stale
    ? { success: false, error: STALE_VERSION_MESSAGE, code: "stale_version", conflict: { entity: "oauth-grant", id: "grant", code: "stale-version" } }
    : { success: true, data: { id: "grant" } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  function Harness() {
    const revoke = useRevokeOAuthGrant("org");
    return <button onClick={() => revoke.mutateAsync({ id: "grant", expectedVersion: 1 })}>Disconnect</button>;
  }
  await act(async () => { tree = create(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
  await act(async () => {
    const result = tree.root.findByType("button").props.onClick();
    if (stale) await expect(result).rejects.toBeInstanceOf(StaleVersionError);
    else expect(await result).toEqual({ id: "grant" });
  });
  expect(actions.revoke).toHaveBeenCalledWith({ id: "grant", expectedVersion: 1 });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: oauthGrantKeys.list("org") });
});
