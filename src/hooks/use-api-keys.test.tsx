import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaleVersionError, STALE_VERSION_CONFLICT_CODE, STALE_VERSION_MESSAGE } from "@/lib/stale-version";
import { API_KEY_DEFAULT_EXPIRY_SECONDS } from "@/config/api-keys";
import { apiKeyKeys, useApiKeys, useCreateApiKey, useRevokeApiKey, useUpdateApiKey } from "./use-api-keys";

const actions = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), revoke: vi.fn() }));
vi.mock("@/fn/api-keys", () => ({
  listApiKeysFn: actions.list,
  createApiKeyFn: actions.create,
  updateApiKeyFn: actions.update,
  revokeApiKeyFn: actions.revoke,
}));

const input = { name: "Example integration", scopes: ["feedstocks:read" as const], expiresIn: API_KEY_DEFAULT_EXPIRY_SECONDS };
let client: QueryClient;
let tree: ReactTestRenderer;

async function render(node: ReactNode) {
  await act(async () => {
    tree = create(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  client.clear();
});

describe("API key hooks", () => {
  it("scopes list keys to the organization and unwraps the safe list response", async () => {
    actions.list.mockResolvedValue({ success: true, data: [] });
    function Harness() { useApiKeys("org-1"); return null; }
    await render(<Harness />);
    await vi.waitFor(() => expect(client.getQueryData(apiKeyKeys.list("org-1"))).toEqual([]));
    expect(client.getQueryData(apiKeyKeys.list("org-2"))).toBeUndefined();
  });

  it("delivers plaintext once to the callback and never caches it", async () => {
    const created = { id: "key-1", key: "test-only-placeholder", name: input.name, expiresAt: null };
    actions.create.mockResolvedValue({ success: true, data: created });
    const onCreated = vi.fn();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    function Harness() {
      const mutation = useCreateApiKey("org-1", onCreated);
      return <button onClick={() => mutation.mutateAsync(input)}>Create</button>;
    }
    await render(<Harness />);
    await act(async () => { expect(await tree.root.findByType("button").props.onClick()).toEqual({ id: "key-1" }); });
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(created);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: apiKeyKeys.list("org-1") });
    const cached = JSON.stringify({ queries: client.getQueryCache().getAll().map((query) => query.state), mutations: client.getMutationCache().getAll().map((mutation) => mutation.state) });
    expect(cached.includes(created.key)).toBe(false);
  });

  it("throws action failures for create, edit and revoke without delivering plaintext", async () => {
    const failure = { success: false, error: "An organization membership is required." };
    actions.create.mockResolvedValue(failure);
    actions.update.mockResolvedValue(failure);
    actions.revoke.mockResolvedValue(failure);
    const onCreated = vi.fn();
    function Harness() {
      const create = useCreateApiKey("org-1", onCreated);
      const update = useUpdateApiKey("org-1");
      const revoke = useRevokeApiKey("org-1");
      return <>
        <button onClick={() => create.mutateAsync(input)}>Create</button>
        <button onClick={() => update.mutateAsync({ id: "key-1", expectedVersion: 1, name: input.name, scopes: input.scopes })}>Update</button>
        <button onClick={() => revoke.mutateAsync({ id: "key-1", expectedVersion: 1 })}>Revoke</button>
      </>;
    }
    await render(<Harness />);
    await act(async () => {
      for (const button of tree.root.findAllByType("button")) {
        await expect(button.props.onClick()).rejects.toThrow(failure.error);
      }
    });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it.each(["update", "revoke"] as const)("refreshes only the current organization's list after a stale %s", async (operation) => {
    actions[operation].mockResolvedValue({
      success: false, error: STALE_VERSION_MESSAGE,
      conflict: { entity: "api-key", id: "key-1", code: STALE_VERSION_CONFLICT_CODE },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    function Harness() {
      const update = useUpdateApiKey("org-1");
      const revoke = useRevokeApiKey("org-1");
      return <button onClick={() => operation === "update"
        ? update.mutateAsync({ id: "key-1", expectedVersion: 1, name: input.name, scopes: input.scopes })
        : revoke.mutateAsync({ id: "key-1", expectedVersion: 1 })}>Save</button>;
    }
    await render(<Harness />);
    await act(async () => {
      await expect(tree.root.findByType("button").props.onClick()).rejects.toBeInstanceOf(StaleVersionError);
    });
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: apiKeyKeys.list("org-1") });
    expect(actions[operation]).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1 }));
  });

  it("surfaces list failures through the query error", async () => {
    actions.list.mockResolvedValue({ success: false, error: "Access refused." });
    function Harness() { useApiKeys("org-1"); return null; }
    await render(<Harness />);
    await vi.waitFor(() => expect(client.getQueryState(apiKeyKeys.list("org-1"))?.error?.message).toBe("Access refused."));
  });
});
