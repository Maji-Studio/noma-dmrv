// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ChainOfCustodyGeoData } from "@/data-access/chain-of-custody-geo";
import CarbonTransitMap from "./carbon-transit-map";

const mocks = vi.hoisted(() => ({ maps: [] as Array<{
  load?: () => void;
  fitBounds: ReturnType<typeof vi.fn>;
}> }));
vi.mock("@/components/map", () => ({ applyBrandRecolor: vi.fn(), MapControls: () => null }));
vi.mock("maplibre-gl", () => ({
  Map: class {
    load?: () => void;
    fitBounds = vi.fn();
    constructor() { mocks.maps.push(this); }
    once(event: string, callback: () => void) { if (event === "load") this.load = callback; }
    on() {}
    addSource() {}
    addLayer() {}
    getLayer() { return {}; }
    getSource() { return { setData: vi.fn() }; }
    setPaintProperty() {}
    resize() {}
    remove() {}
  },
  LngLatBounds: class {
    points: unknown[] = [];
    extend(point: unknown) { this.points.push(point); return this; }
  },
  Popup: class { remove() {} },
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
}));
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

const geo: ChainOfCustodyGeoData = {
  facility: { id: "facility", code: "FAC", name: "Facility", lat: -6, lng: 35 },
  nodes: [{
    id: "application:app", entityId: "app", kind: "application", code: "APP",
    lat: -7, lng: 39, positionSource: "own", inheritedFromFacility: false, sub: null,
  }],
  legs: [], warnings: [],
};
const movedGeo = { ...geo, nodes: [{ ...geo.nodes[0], lat: -8, lng: 40 }] };
const props = {
  routeGeometries: undefined, popupContent: {}, highlight: null, focus: null, hoverLegId: null,
};
afterEach(() => { cleanup(); mocks.maps.length = 0; });

it("fits the latest geography inside load, before React commits style readiness (StrictMode)", async () => {
  const view = render(<StrictMode><CarbonTransitMap {...props} geo={geo} /></StrictMode>);
  view.rerender(<StrictMode><CarbonTransitMap {...props} geo={movedGeo} /></StrictMode>);
  const map = mocks.maps.at(-1)!;
  expect(map.fitBounds).not.toHaveBeenCalled();
  await act(async () => {
    map.load!();
    expect(map.fitBounds).toHaveBeenCalled();
    expect(map.fitBounds.mock.lastCall?.[0].points).toContainEqual([40, -8]);
  });
});

it("refits when geography changes after load", async () => {
  const view = render(<CarbonTransitMap {...props} geo={geo} />);
  const map = mocks.maps.at(-1)!;
  await act(async () => { map.load!(); });
  map.fitBounds.mockClear();
  view.rerender(<CarbonTransitMap {...props} geo={movedGeo} />);
  expect(map.fitBounds.mock.lastCall?.[0].points).toContainEqual([40, -8]);
});

it("fits a customer route endpoint beyond the application's field marker", async () => {
  const customerGeo: ChainOfCustodyGeoData = {
    ...geo,
    legs: [{
      id: "outbound", kind: "outbound", entityType: "biochar", entityId: "product",
      originLat: -6, originLng: 35, destinationLat: -9, destinationLng: 41,
      originName: null, destinationName: null, distanceKm: 25, distanceSource: "manual",
      isDerived: true, loadMassKg: 100, appliedWetMassKg: 100, materialLabel: null,
      outerHref: null, outerCode: null, outerNodeId: "application:app",
    }],
  };
  render(<CarbonTransitMap {...props} geo={customerGeo} />);
  const map = mocks.maps.at(-1)!;
  await act(async () => { map.load!(); });
  expect(map.fitBounds.mock.lastCall?.[0].points).toContainEqual([41, -9]);
});
