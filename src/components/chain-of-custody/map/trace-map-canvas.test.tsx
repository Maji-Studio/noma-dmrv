// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChainOfCustodyGeoData } from "@/data-access/chain-of-custody-geo";
import TraceMapCanvas, { type TraceMapCanvasProps } from "./trace-map-canvas";
import type { MapLighting } from "./trace-model";
import { buildTraceModel } from "./trace-model";
import { BATCH_EDGES, BATCH_NODES, batchGeo, geoNode } from "./trace-fixtures";
import type { ChainWalk } from "./trace-chains";
import { TraceMapView } from "./trace-map-view";

type Camera = { points: number[][] };
const mocks = vi.hoisted(() => ({ maps: [] as Array<{
  load?: () => void;
  cameraForBounds: ReturnType<typeof vi.fn>;
  flyTo: ReturnType<typeof vi.fn>;
}> }));
vi.mock("@/components/map", () => ({ applyBrandRecolor: vi.fn(), armBasemapFallback: () => () => {}, BasemapUnavailableNote: () => null, MapControls: () => null }));
vi.mock("./lazy-trace-map-canvas", async () => ({ LazyTraceMapCanvas: (await import("./trace-map-canvas")).default }));
vi.mock("@/hooks/use-media-query", () => ({ useIsMobile: () => false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
      container: HTMLElement;
      cameraForBounds = vi.fn((bounds: LngLatBounds): Camera => ({ points: bounds.points }));
      flyTo = vi.fn();
      constructor({ container }: { container: HTMLElement }) {
        this.container = container;
        Object.defineProperties(container, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
        mocks.maps.push(this);
      }
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
      addTo(map: { container: HTMLElement }) { map.container.appendChild(this.element); return this; }
      remove() { this.element.remove(); }
    },
  };
});
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
Element.prototype.scrollTo = vi.fn();

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

it.each([true, false])("renders and walks an unapplied delivery destination (facility GPS: %s)", async (hasFacilityGps) => {
  const destination = { lat: -7, lng: 39 };
  const data = batchGeo({
    ...(!hasFacilityGps ? { facility: { ...geo.facility, lat: null, lng: null } } : {}),
    nodes: [geoNode("delivery", "delivery:dl1", "DL-26-001", destination)],
    legs: [],
  });
  const model = buildTraceModel(BATCH_NODES.slice(2, 5), BATCH_EDGES.slice(2, 4), data);
  function DeliveryView() {
    const [walk, setWalk] = useState<ChainWalk | null>(null);
    return <TraceMapView model={model} routeGeometries={undefined} walk={walk} onWalkChange={setWalk} />;
  }
  render(<DeliveryView />);
  await act(async () => { mocks.maps.at(-1)!.load!(); });

  const map = within(screen.getByTestId("carbon-viewer-map"));
  const marker = map.getByRole("button", { name: "DL-26-001" });
  expect(map.getAllByTestId("carbon-viewer-marker")).toHaveLength(hasFacilityGps ? 2 : 1);
  expect(marker.dataset.position).toBe(JSON.stringify([destination.lng, destination.lat]));
  expect(marker.classList.contains("cvm-mk--customer")).toBe(true);
  expect(marker.tabIndex).toBe(0);
  expect(lastFrame().points).toContainEqual([destination.lng, destination.lat]);

  const panel = within(screen.getByRole("complementary"));
  expect(panel.queryByText("1 delivery · no location recorded")).toBeNull();
  fireEvent.click(panel.getByRole("button", { name: /Delivery/ }));
  expect(lastFrame().points).toEqual([[destination.lng, destination.lat]]);
  fireEvent.click(marker);
  expect(panel.getByText("01 / 03 · To DL-26-001")).toBeTruthy();
  fireEvent.click(panel.getByRole("button", { name: /^Next/ }));
  fireEvent.click(panel.getByRole("button", { name: /^Next/ }));
  expect(panel.getByText("03 / 03 · To DL-26-001")).toBeTruthy();
  expect(marker.classList.contains("tm-current")).toBe(true);
  expect(marker.classList.contains("cvm-dim")).toBe(false);
  expect(lastFrame().points).toEqual([[destination.lng, destination.lat]]);

  // Keyboard selection of the destination returns the walk to the delivery.
  fireEvent.click(panel.getByRole("button", { name: /^Back/ }));
  expect(marker.classList.contains("tm-current")).toBe(false);
  fireEvent.keyDown(marker, { key: "Enter" });
  expect(panel.getByText("03 / 03 · To DL-26-001")).toBeTruthy();
  expect(marker.classList.contains("tm-current")).toBe(true);
});

it("keeps deliveries without GPS on the facility fallback without a destination marker", async () => {
  const data = batchGeo({
    nodes: [{ ...geoNode("delivery", "delivery:dl1", "DL-26-001", null), lat: -6, lng: 35 }],
    legs: [],
  });
  const model = buildTraceModel(BATCH_NODES.slice(2, 5), BATCH_EDGES.slice(2, 4), data);
  render(<TraceMapView model={model} routeGeometries={undefined} walk={{ endId: "delivery:dl1", stepIndex: 2, openRecordId: null }} onWalkChange={vi.fn()} />);
  await act(async () => { mocks.maps.at(-1)!.load!(); });

  const map = within(screen.getByTestId("carbon-viewer-map"));
  expect(map.queryByRole("button", { name: "DL-26-001" })).toBeNull();
  expect(map.getAllByTestId("carbon-viewer-marker")).toHaveLength(1);
  expect(map.getByTestId("carbon-viewer-marker").dataset.nodeId).toBe("facility:fac-1");
  expect(lastFrame().points).toEqual([[data.facility.lng, data.facility.lat]]);
});
