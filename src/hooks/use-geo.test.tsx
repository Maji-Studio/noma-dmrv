// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { useRouteGeometries } from "./use-geo";
import type { RouteGeometriesRequest } from "@/schemas/geo";

const mocks = vi.hoisted(() => ({ route: vi.fn() }));
vi.mock("@/fn/geo", () => ({ routeGeometriesFn: mocks.route }));

it("requests new geometry for changed endpoints with the same leg id, retaining coordinate-keyed caches", async () => {
  mocks.route.mockImplementation(async () => ({ success: true, data: {} }));
  const client = new QueryClient();
  const initial: RouteGeometriesRequest = {
    legs: [{ id: "leg", origin: { lat: -6, lng: 35 }, destination: { lat: -7, lng: 39 } }],
  };
  const movedDestination = { legs: [{ ...initial.legs[0], destination: { lat: -8, lng: 40 } }] };
  const movedOrigin = { legs: [{ ...initial.legs[0], origin: { lat: -5, lng: 34 } }] };
  const view = renderHook((request) => useRouteGeometries(request), {
    initialProps: initial,
    wrapper: ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  try {
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(mocks.route).toHaveBeenCalledExactlyOnceWith(initial);
    view.rerender(movedDestination);
    await waitFor(() => expect(mocks.route).toHaveBeenCalledWith(movedDestination));
    view.rerender(movedOrigin);
    await waitFor(() => expect(mocks.route).toHaveBeenCalledWith(movedOrigin));
    await act(async () => { view.rerender(initial); });
    expect(mocks.route).toHaveBeenCalledTimes(3);
  } finally {
    view.unmount();
    client.clear();
  }
});
