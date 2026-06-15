/**
 * ORS adapter URL contract. The real adapter is never exercised in CI (tests
 * use the `stub` GeoProvider), so a wrong host or path would only surface at
 * runtime in production — exactly what bit us migrating off the deprecated
 * api.openrouteservice.org. These tests mock `fetch` and assert each method
 * hits the correct api.heigit.org endpoint and sends the snap radius.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ORS_SNAP_RADIUS_METERS } from "@/config/geo";

// Preserve the real env (the logger reads LOG_LEVEL) — only force the key on,
// so requireKey() doesn't short-circuit before the fetch we want to inspect.
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return { ...actual, env: { ...actual.env, OPENROUTESERVICE_API_KEY: "test-ors-key" } };
});

const { orsProvider } = await import("@/lib/geo/ors");

function mockFetch(body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

function calledUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls[0]?.[0]);
}

function calledBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
}

afterEach(() => vi.unstubAllGlobals());

describe("orsProvider URL contract (api.heigit.org)", () => {
  it("geocode hits the pelias search endpoint", async () => {
    const fetchMock = mockFetch({ features: [] });
    await orsProvider.geocode("Moshi");
    expect(calledUrl(fetchMock)).toMatch(
      /^https:\/\/api\.heigit\.org\/pelias\/v1\/search\?/
    );
  });

  it("reverseGeocode hits the pelias reverse endpoint", async () => {
    const fetchMock = mockFetch({ features: [{ properties: { label: "X" } }] });
    await orsProvider.reverseGeocode({ lat: -3.35, lng: 37.33 });
    expect(calledUrl(fetchMock)).toMatch(
      /^https:\/\/api\.heigit\.org\/pelias\/v1\/reverse\?/
    );
  });

  it("routeDistanceKm posts to the directions endpoint with the snap radius", async () => {
    const fetchMock = mockFetch({ routes: [{ summary: { distance: 5000 } }] });
    await orsProvider.routeDistanceKm({ lat: -3.35, lng: 37.33 }, { lat: -3.25, lng: 37.45 });
    expect(calledUrl(fetchMock)).toBe(
      "https://api.heigit.org/openrouteservice/v2/directions/driving-car"
    );
    expect(calledBody(fetchMock).radiuses).toEqual([
      ORS_SNAP_RADIUS_METERS,
      ORS_SNAP_RADIUS_METERS,
    ]);
  });

  it("routeGeometry posts to the geojson directions endpoint with the snap radius", async () => {
    const fetchMock = mockFetch({
      features: [
        {
          geometry: {
            coordinates: [
              [37.33, -3.35],
              [37.45, -3.25],
            ],
          },
          properties: { summary: { distance: 5000 } },
        },
      ],
    });
    await orsProvider.routeGeometry({ lat: -3.35, lng: 37.33 }, { lat: -3.25, lng: 37.45 });
    expect(calledUrl(fetchMock)).toBe(
      "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson"
    );
    expect(calledBody(fetchMock).radiuses).toEqual([
      ORS_SNAP_RADIUS_METERS,
      ORS_SNAP_RADIUS_METERS,
    ]);
  });
});
