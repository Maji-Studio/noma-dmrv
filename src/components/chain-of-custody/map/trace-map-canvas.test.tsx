// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChainOfCustodyGeoData } from "@/data-access/chain-of-custody-geo";
import TraceMapCanvas, { type TraceMapCanvasProps } from "./trace-map-canvas";
import type { MapLighting } from "./trace-model";

type Camera = { points: number[][] };
const mocks = vi.hoisted(() => ({ maps: [] as Array<{
  load?: () => void;
  cameraForBounds: ReturnType<typeof vi.fn>;
  flyTo: ReturnType<typeof vi.fn>;
}> }));
vi.mock("@/components/map", () => ({ applyBrandRecolor: vi.fn(), MapControls: () => null }));
vi.mock("maplibre-gl", () => {
  class LngLatBounds {
    points: number[][] = [];
    extend(point: number[]) { this.points.push(point); return this; }
    getNorthEast() { return { distanceTo: () => Number.MAX_SAFE_INTEGER }; }
    getSouthWest() { return {}; }
  }
  return {
    Map: class {
      load?: () => void;
      container = { clientWidth: 800, clientHeight: 600 };
      cameraForBounds = vi.fn((bounds: LngLatBounds): Camera => ({ points: bounds.points }));
      flyTo = vi.fn();
      constructor() { mocks.maps.push(this); }
      addControl() {}
      once(event: string, callback: () => void) { if (event === "load") this.load = callback; }
      on() {}
      addSource() {}
      addLayer() {}
      getLayer() { return {}; }
      getSource() { return { setData: vi.fn() }; }
      getContainer() { return this.container; }
      project() { return { x: 0, y: 0 }; }
      setPaintProperty() {}
      resize() {}
      remove() {}
    },
    AttributionControl: class {},
    LngLatBounds,
    Marker: class {
      point?: number[];
      element: HTMLElement;
      constructor({ element }: { element: HTMLElement }) { this.element = element; }
      setLngLat(point: number[]) { this.point = point; return this; }
      getLngLat() { return this.point; }
      getElement() { return this.element; }
      addTo() { return this; }
      remove() {}
    },
  };
});
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

const geo: ChainOfCustodyGeoData = {
  facility: { id: "facility", code: "FAC", name: "Facility", lat: -6, lng: 35 },
  nodes: [],
  legs: [],
  warnings: [],
};
const lighting = (points: { lat: number; lng: number }[]): MapLighting => ({
  nodeIds: null,
  legIds: new Set(),
  points,
  facilityLit: false,
  currentNodeIds: new Set(),
});
const props = (overrides: Partial<TraceMapCanvasProps>): TraceMapCanvasProps => ({
  geo,
  legs: [],
  routeGeometries: undefined,
  lighting: lighting([{ lat: -6, lng: 35 }, { lat: -7, lng: 39 }]),
  frameKey: "chain|application:app|5",
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  ...overrides,
});
const lastFrame = () => {
  const map = mocks.maps.at(-1)!;
  return { points: (map.flyTo.mock.lastCall?.[0] as Camera).points, duration: map.flyTo.mock.lastCall?.[0].duration as number };
};

afterEach(() => { cleanup(); mocks.maps.length = 0; });

it("flies to a new selection", async () => {
  const view = render(<TraceMapCanvas {...props({})} />);
  await act(async () => { mocks.maps.at(-1)!.load!(); });
  expect(lastFrame().duration).toBeGreaterThan(0);
  view.rerender(<TraceMapCanvas {...props({ frameKey: "chain|application:app|0", lighting: lighting([{ lat: -8, lng: 36 }]) })} />);
  expect(lastFrame()).toEqual({ points: [[36, -8]], duration: expect.any(Number) });
  expect(lastFrame().duration).toBeGreaterThan(0);
});

it("refits when geography changes after load, without the flight", async () => {
  const view = render(<TraceMapCanvas {...props({})} />);
  const map = mocks.maps.at(-1)!;
  await act(async () => { map.load!(); });
  map.flyTo.mockClear();
  // The same selection, re-derived from an identical payload: the camera stays.
  view.rerender(<TraceMapCanvas {...props({ lighting: lighting([{ lat: -6, lng: 35 }, { lat: -7, lng: 39 }]) })} />);
  expect(map.flyTo).not.toHaveBeenCalled();
  // The field moved (an edit refetched the payload): refit on its new place.
  view.rerender(<TraceMapCanvas {...props({ lighting: lighting([{ lat: -6, lng: 35 }, { lat: -8, lng: 40 }]) })} />);
  expect(lastFrame()).toEqual({ points: [[35, -6], [40, -8]], duration: 0 });
});
