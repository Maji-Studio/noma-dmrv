// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { entityKeys } from "./entity-query-keys";
import { useRefreshEntityOptionsOnReturn } from "./use-refresh-entity-options-on-return";

let client: QueryClient;
let visibility: DocumentVisibilityState;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

function setup() {
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => useRefreshEntityOptionsOnReturn("reactor"), { wrapper });
  const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  return { leave: result.current, invalidatedKeys };
}

it("reloads the reactor options once when the operator comes back to the tab", () => {
  const { leave, invalidatedKeys } = setup();

  act(() => leave());
  expect(invalidatedKeys()).toEqual([]);

  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(invalidatedKeys()).toEqual([entityKeys.listPrefix("reactor"), entityKeys.detailPrefix("reactor")]);

  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(invalidatedKeys()).toHaveLength(2);
});

it("reloads on the page turning visible, but not while it is hidden", () => {
  const { leave, invalidatedKeys } = setup();
  act(() => leave());

  visibility = "hidden";
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(invalidatedKeys()).toEqual([]);

  visibility = "visible";
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(invalidatedKeys()).toEqual([entityKeys.listPrefix("reactor"), entityKeys.detailPrefix("reactor")]);
});

it("waits for one return however often the operator follows the link", () => {
  const { leave, invalidatedKeys } = setup();
  act(() => { leave(); leave(); });
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(invalidatedKeys()).toHaveLength(2);

  act(() => leave());
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(invalidatedKeys()).toHaveLength(4);
});
