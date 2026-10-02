/**
 * Map smoke test (hermetic): the bundled MapLibre worker starts and the map
 * loads and renders vector tiles.
 *
 * Guards against the maplibre-gl 6 break (PR #752, fixed by #870): Turbopack
 * rewrote the worker URL to file://, MapLibre ran `new Worker("")`, and since
 * the worker fetches tiles, no vector tile request ever left the page. Unit
 * tests mock MapLibre and CI has no MapTiler key, so nothing noticed for 20
 * days.
 *
 * The page /e2e/map-smoke renders the real GIS boundary preview map against a
 * fixture style on an `.invalid` host; this spec answers those requests via
 * `page.route`, so no MapTiler key and no network are needed. SwiftShader
 * gives headless Chromium the WebGL2 context MapLibre requires (issue #801).
 */

import type { Page } from "@playwright/test";
import {
  MAP_SMOKE_FIXTURE_ORIGIN,
  MAP_SMOKE_STYLE_URL,
} from "@/app/e2e/map-smoke/map-smoke-fixture";
import { test, expect } from "./fixtures";
import { fullExtentVectorTile, mapSmokeStyle } from "./helpers/map-smoke-tiles";

const MAP_SMOKE_PATH = "/e2e/map-smoke";
const SWIFTSHADER_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const TILE_PATH = /^\/tiles\/\d+\/\d+\/\d+\.pbf$/;
const WORKER_OR_GPU_ERROR = /worker|GPUInitializationError|WebGL/i;
// Covers first-hit Turbopack compilation of the map chunk in local dev runs.
const MAP_READY_TIMEOUT_MS = 45_000;
const CORS_HEADERS = { "access-control-allow-origin": "*" };
const HTTP_NOT_FOUND = 404;

test.use({ launchOptions: { args: SWIFTSHADER_ARGS } });

/** Serves the fixture basemap and records every vector tile it answers. */
async function serveFixtureBasemap(page: Page): Promise<string[]> {
  const servedTiles: string[] = [];
  const tile = fullExtentVectorTile();

  // Keep the page offline even if a real basemap host is ever requested.
  await page.route("**://api.maptiler.com/**", (route) => route.abort());
  await page.route("**://server.arcgisonline.com/**", (route) => route.abort());

  await page.route(`${MAP_SMOKE_FIXTURE_ORIGIN}/**`, async (route) => {
    const url = route.request().url();
    if (url === MAP_SMOKE_STYLE_URL) {
      await route.fulfill({ json: mapSmokeStyle(), headers: CORS_HEADERS });
      return;
    }
    if (TILE_PATH.test(new URL(url).pathname)) {
      servedTiles.push(url);
      await route.fulfill({
        body: tile,
        contentType: "application/x-protobuf",
        headers: CORS_HEADERS,
      });
      return;
    }
    await route.fulfill({ status: HTTP_NOT_FOUND, headers: CORS_HEADERS });
  });

  return servedTiles;
}

test.describe("Map smoke", () => {
  test("the MapLibre worker loads and renders vector tiles", async ({
    viewerPage: page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("worker", (worker) => {
      worker.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
    });

    const servedTiles = await serveFixtureBasemap(page);
    await page.goto(MAP_SMOKE_PATH);

    // "ready" = first idle after load with no map error since the style
    // parsed: every requested tile was fetched, decoded by the worker and
    // painted, and the GeoJSON boundary rendered. A tile the worker cannot
    // decode settles as "error" instead.
    await expect(page.getByTestId("geojson-preview-map")).toHaveAttribute(
      "data-map-state",
      "ready",
      { timeout: MAP_READY_TIMEOUT_MS },
    );
    expect(servedTiles.length).toBeGreaterThan(0);
    expect(errors.filter((error) => WORKER_OR_GPU_ERROR.test(error))).toEqual([]);
  });
});
